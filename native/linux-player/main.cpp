#include "bridge.h"
#include "policy.h"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QQuickWebEngineProfile>
#include <QtWebEngineQuick/qtwebenginequickglobal.h>
#include <QWebEngineUrlRequestInterceptor>
#include <QWebEngineUrlRequestInfo>
#include <QFileInfo>
#include <QDir>
#include <QTemporaryDir>
#include <QSocketNotifier>
#include <QTimer>
#include <QJsonObject>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <csignal>
#include <cerrno>
#include <cstdio>

class AssetGate final : public QWebEngineUrlRequestInterceptor {
public:
    explicit AssetGate(QString root, QUrl server, QObject *parent)
        : QWebEngineUrlRequestInterceptor(parent), root(std::move(root)), server(std::move(server)) {}
    void interceptRequest(QWebEngineUrlRequestInfo &info) override {
        const auto url = info.requestUrl();
        if (info.resourceType() == QWebEngineUrlRequestInfo::ResourceTypeImage
            && PlayerPolicy::mediaUri(url.toString()) && url.scheme() == server.scheme()
            && url.host() == server.host() && url.port() == server.port()) return;
        if (url.scheme() == "qrc" && url.path() == "/qtwebchannel/qwebchannel.js") return;
        if (url.scheme() == "data" && info.resourceType() != QWebEngineUrlRequestInfo::ResourceTypeMainFrame
            && info.resourceType() != QWebEngineUrlRequestInfo::ResourceTypeSubFrame) return;
        if (url.isLocalFile()) {
            const auto path = QFileInfo(url.toLocalFile()).canonicalFilePath();
            if (!path.isEmpty() && path.startsWith(root + QDir::separator()) && info.resourceType() != QWebEngineUrlRequestInfo::ResourceTypeSubFrame) return;
        }
        info.block(true);
    }
private:
    QString root;
    QUrl server;
};

// Never print untrusted Chromium/mpv/Qt messages: console and decoder errors can
// contain authenticated source URIs. Process status uses generic stdout events.
static void privateMessages(QtMsgType, const QMessageLogContext &, const QString &message) {
    // Opt-in diagnostics only for CI's public fixtures. Drop complete messages
    // containing authenticated/network addresses instead of imperfect redaction.
    if (qEnvironmentVariable("ZENITH_QT_DIAGNOSTICS") != "1" || qEnvironmentVariable("CI") != "true") return;
    if (message.contains("://") && !message.contains("qrc:/")) return;
    for (const QString &secret : {"http:", "https:", "api_key", "token", "authorization"})
        if (message.contains(secret, Qt::CaseInsensitive)) return;
    const auto bytes = message.left(2048).toUtf8();
    std::fprintf(stderr, "Qt diagnostic: %s\n", bytes.constData());
}
static std::optional<QByteArray> readBootstrap() {
    QByteArray line;
    while (line.size() <= PlayerPolicy::maxLine) {
        pollfd descriptor{STDIN_FILENO, POLLIN, 0};
        if (::poll(&descriptor, 1, 10000) <= 0) return std::nullopt;
        char c;
        const auto count = ::read(STDIN_FILENO, &c, 1);
        if (count < 0 && errno == EINTR) continue;
        if (count != 1) return std::nullopt;
        if (c == '\n') return line;
        line.append(c);
    }
    return std::nullopt;
}
int main(int argc, char **argv) {
    std::signal(SIGPIPE, SIG_IGN);
    qInstallMessageHandler(privateMessages);
    const auto line = readBootstrap();
    auto bootstrap = line ? PlayerPolicy::bootstrap(*line) : std::nullopt;
    if (!bootstrap) { Bridge::output({{"type", "error"}, {"message", "Player bootstrap is invalid."}}); return 2; }
    QString assets;
    for (int i = 1; i < argc; ++i) {
        if (QString::fromLocal8Bit(argv[i]) == "--assets" && i + 1 < argc) assets = QString::fromLocal8Bit(argv[++i]);
        else { Bridge::output({{"type", "error"}, {"message", "Player arguments are invalid."}}); return 2; }
    }
    assets = QFileInfo(assets).canonicalFilePath();
    auto html = QFileInfo(QDir(assets).filePath("qt-player.html")).canonicalFilePath();
    if (assets.isEmpty() || html.isEmpty() || !html.startsWith(assets + QDir::separator())) {
        Bridge::output({{"type", "error"}, {"message", "Player assets are missing."}}); return 2;
    }
    // MpvQt explicitly includes an mpvqt.conf. A fresh private XDG config home
    // prevents user configurations/scripts from adding commands or logging URLs.
    QTemporaryDir privateConfig(QDir::tempPath() + "/zenith-player-XXXXXX");
    if (!privateConfig.isValid()) return 2;
    qputenv("XDG_CONFIG_HOME", privateConfig.path().toUtf8());
    qputenv("XDG_CACHE_HOME", (privateConfig.path() + "/cache").toUtf8());
    qputenv("QT_LOGGING_RULES", "*.debug=false;*.info=false;*.warning=false");
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QtWebEngineQuick::initialize();
    QGuiApplication app(argc, argv);
    app.setApplicationName("Zenith");
    app.setOrganizationName("Zenith");
    qmlRegisterType<VideoItem>("Zenith.Native", 1, 0, "MpvQtVideoItem");
    const QUrl entry = QUrl::fromLocalFile(html);
    const auto server = bootstrap->value("group").toMap().value("servers").toMap().value("jellyfin").toMap().value("url").toString();
    Bridge bridge(std::move(*bootstrap), entry);
    QQuickWebEngineProfile profile;
    profile.setOffTheRecord(true);
    AssetGate gate(assets, QUrl(server), &profile);
    profile.setUrlRequestInterceptor(&gate);
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("nativeBridge", &bridge);
    engine.rootContext()->setContextProperty("trustedProfile", &profile);
    engine.rootContext()->setContextProperty("playerEntry", entry);
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, [&] {
        Bridge::output({{"type", "error"}, {"message", "Player window could not start."}});
        app.exit(3);
    }, Qt::QueuedConnection);
    // Parent crash/closed pipe terminates the child. Input never blocks the UI.
    const int oldFlags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, oldFlags | O_NONBLOCK);
    QSocketNotifier input(STDIN_FILENO, QSocketNotifier::Read);
    QByteArray pending;
    QObject::connect(&input, &QSocketNotifier::activated, &app, [&] {
        char buffer[4096];
        while (true) {
            const auto n = ::read(STDIN_FILENO, buffer, sizeof(buffer));
            if (!n) { input.setEnabled(false); bridge.shutdown(); return; }
            if (n < 0) {
                if (errno == EINTR) continue;
                if (errno != EAGAIN && errno != EWOULDBLOCK) bridge.shutdown();
                break;
            }
            pending.append(buffer, int(n));
            if (pending.size() > PlayerPolicy::maxLine) { bridge.shutdown(); return; }
            qsizetype end;
            while ((end = pending.indexOf('\n')) >= 0) {
                auto bytes = pending.left(end); pending.remove(0, end + 1);
                QJsonParseError error;
                const auto doc = QJsonDocument::fromJson(bytes, &error);
                if (error.error || !doc.isObject()) { bridge.shutdown(); return; }
                const auto event = doc.object();
                if (event.value("type") == "close") bridge.requestClose();
                else if (event.value("type") == "media-key" && event.value("data").isString()) bridge.mediaKey(event.value("data").toString());
            }
        }
    });
    QTimer::singleShot(45000, &app, [&] {
        // A hung WebEngine/renderer must not keep a hidden handoff process alive.
        if (engine.rootObjects().isEmpty()) bridge.shutdown();
    });
    engine.load(QUrl("qrc:/Main.qml"));
    return app.exec();
}
