#include "bridge.h"
#include "policy.h"
#include <QCoreApplication>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QSet>
#include <QBuffer>
#include <QImage>
#include <cstdio>
#include <cmath>
#include <algorithm>
#include <memory>

Bridge::Bridge(QVariantMap bootstrap, QUrl entry, QObject *parent)
    : QObject(parent), bootstrapData(std::move(bootstrap)), entryUrl(std::move(entry)) {
    setObjectName("bridge");
}
void Bridge::output(const QVariantMap &event) {
    QByteArray line = QJsonDocument::fromVariant(event).toJson(QJsonDocument::Compact);
    if (line.size() > PlayerPolicy::maxLine) return;
    line.append('\n');
    std::fwrite(line.constData(), 1, size_t(line.size()), stdout);
    std::fflush(stdout);
}
void Bridge::attach(QObject *item, QObject *win) {
    if (video || window) return;
    video = qobject_cast<VideoItem *>(item);
    window = qobject_cast<QQuickWindow *>(win);
    if (!video || !window) { shutdown(); return; }
    const auto geometry = bootstrapData.value("window").toMap();
    if (geometry.value("width").toInt() >= 320 && geometry.value("height").toInt() >= 180)
        window->resize(std::clamp(geometry.value("width").toInt(), 320, 16384),
                       std::clamp(geometry.value("height").toInt(), 180, 16384));
    // Global positioning is intentionally left to Wayland's compositor.
    if (QGuiApplication::platformName() == "xcb" && !geometry.value("x").isNull() && !geometry.value("y").isNull())
        window->setPosition(geometry.value("x").toInt(), geometry.value("y").toInt());
    if (geometry.value("fullscreen").toBool()) window->showFullScreen();
    else if (geometry.value("maximized").toBool()) window->showMaximized();
    else window->show();
    connect(video, &VideoItem::snapshotChanged, this, [this](const QVariantMap &s) { emit event("media", s); });
    connect(video, &VideoItem::rendererInitialized, this, &Bridge::checkReady);
    checkReady();
}
bool Bridge::trustedNavigation(const QUrl &url) const { return url == entryUrl; }
void Bridge::uiLoaded(bool success) {
    if (!success) { output({{"type", "error"}, {"message", "Player controls could not load."}}); shutdown(); return; }
    loaded = true; checkReady();
}
void Bridge::checkReady() {
    if (!sentReady && bootstrapped && loaded && video && video->initialized() && window && window->isVisible()) {
        sentReady = true;
        output({{"type", "ready"}});
    }
}
void Bridge::finish(const QString &id, const QVariant &result) { emit completed(id, {{"ok", true}, {"data", result}}); }
void Bridge::reject(const QString &id, const QString &message) { emit completed(id, {{"ok", false}, {"error", message}}); }
void Bridge::requestClose() {
    if (closing || closeRequested) return;
    closeRequested = true;
    emit event("close-request", {});
    QTimer::singleShot(1500, this, &Bridge::shutdown);
}
void Bridge::mediaKey(const QString &key) {
    static const QSet<QString> keys = {"toggle", "play", "pause", "playpause", "stop", "next", "previous", "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaNext", "MediaPrevious"};
    if (keys.contains(key)) emit event("media-key", {{"key", key}});
}
void Bridge::shutdown() {
    if (closing) return;
    closing = true; emit exitingChanged();
    QVariantMap e{{"type", "closed"}};
    // Position is safe; never echo bootstrap, URLs or server credentials.
    if (video) {
        auto s = video->snapshot();
        QVariantMap preferences{{"currentTime", s.value("currentTime")}, {"duration", s.value("duration")},
            {"volume", s.value("volume")}, {"rate", s.value("rate")}, {"muted", s.value("muted")}};
        for (auto it = retainedPlayback.cbegin(); it != retainedPlayback.cend(); ++it) preferences[it.key()] = it.value();
        e["playback"] = preferences;
        video->control("media.stop", {});
    }
    output(e);
    QCoreApplication::quit();
}
QVariantMap Bridge::windowState() const {
    return {{"fullscreen", window && window->visibility() == QWindow::FullScreen},
        {"mini", mini}, {"maximized", window && window->visibility() == QWindow::Maximized}, {"pinned", pinned}};
}
void Bridge::request(const QString &id, const QString &action, const QVariantMap &args) {
    if (closing || id.isEmpty() || id.size() > 128 || action.size() > 64
        || QJsonDocument::fromVariant(args).toJson(QJsonDocument::Compact).size() > PlayerPolicy::maxLine) { reject(id); return; }
    if (action == "bootstrap") {
        bootstrapped = true;
        auto payload = bootstrapData;
        payload["backend"] = "qt-mpv";
        payload["qtVersion"] = qVersion();
        finish(id, payload);
        QTimer::singleShot(0, this, &Bridge::checkReady);
        return;
    }
    if (!bootstrapped) { reject(id); return; }
    if (action == "diagnostic.state") {
        if (!PlayerPolicy::diagnosticCapture(qEnvironmentVariable("CI"), qEnvironmentVariable("ZENITH_QT_DIAGNOSTICS"))) {
            reject(id, "Unsupported player request."); return;
        }
        finish(id, QVariantMap{{"ready", sentReady}, {"visible", window && window->isVisible()}});
        return;
    }
    if (action == "diagnostic.capture") {
        if (!PlayerPolicy::diagnosticCapture(qEnvironmentVariable("CI"), qEnvironmentVariable("ZENITH_QT_DIAGNOSTICS")) || !window) {
            reject(id, "Unsupported player request."); return;
        }
        // Capture the final Qt Quick scene, including the libmpv framebuffer
        // underneath Chromium. No file paths or arbitrary output destinations.
        const QImage image = window->grabWindow();
        QByteArray png;
        QBuffer buffer(&png);
        if (image.isNull() || !buffer.open(QIODevice::WriteOnly) || !image.save(&buffer, "PNG")) {
            reject(id, "Player capture failed."); return;
        }
        finish(id, QVariantMap{{"png", QString::fromLatin1(png.toBase64())}, {"width", image.width()}, {"height", image.height()}});
        return;
    }
    if (action == "http") { http(id, args); return; }
    if (action == "media.open") {
        if (!video || !PlayerPolicy::mediaUri(args.value("uri").toString())) { reject(id, "Only original HTTP media is supported."); return; }
        for (const QString &k : {"volume", "rate"}) {
            if (args.contains(k) && !std::isfinite(args.value(k).toDouble())) { reject(id); return; }
        }
        finish(id, video->open(args)); return;
    }
    if (action.startsWith("media.")) {
        if (video && args.contains("generation") && args.value("generation").toULongLong() != video->snapshot().value("generation").toULongLong()) { finish(id); return; }
        if (video && video->control(action, args)) finish(id);
        else reject(id, "Unsupported media request.");
        return;
    }
    if (action == "win" && window) {
        const QString command = args.value("action").toString();
        const auto arg = args.value("arg");
        if (command == "state") {}
        else if (command == "close") requestClose();
        else if (command == "minimize") window->showMinimized();
        else if (command == "maximize") {
            if (window->visibility() == QWindow::Maximized) window->showNormal(); else window->showMaximized();
        } else if (command == "fullscreen") {
            bool on = arg.isValid() ? arg.toBool() : window->visibility() != QWindow::FullScreen;
            if (on) window->showFullScreen(); else window->showNormal();
        } else if (command == "mini") {
            bool on = arg.isValid() ? arg.toBool() : !mini;
            if (on != mini) {
                if (on) { normalGeometry = window->geometry(); window->showNormal(); window->resize(480, 270); }
                else if (normalGeometry.isValid()) window->setGeometry(normalGeometry);
                mini = on;
                window->setFlag(Qt::WindowStaysOnTopHint, mini || pinned); window->show();
            }
        } else if (command == "pin") {
            pinned = arg.isValid() ? arg.toBool() : !pinned;
            window->setFlag(Qt::WindowStaysOnTopHint, mini || pinned); window->show();
        } else if (command == "drag") window->startSystemMove();
        else { reject(id, "Unsupported window request."); return; }
        finish(id, windowState()); return;
    }
    if (action == "discord") {
        const QVariant activity = args.value("activity");
        if (QJsonDocument::fromVariant(args).toJson().size() > 16384) { reject(id); return; }
        // Presence values must never become a covert source-URI logging path.
        QVariantMap safe;
        auto activityMap = activity.toMap();
        for (const QString &field : {"details", "state", "text", "start", "end", "largeImageKey", "largeImageText", "smallImageKey", "smallImageText", "startTimestamp", "endTimestamp", "type", "name"}) {
            auto value = activityMap.value(field);
            const QString text = value.toString();
            if (value.isValid() && text.size() <= 256 && !text.contains("://") && !text.contains("api_key", Qt::CaseInsensitive)) safe[field] = value;
        }
        output({{"type", "discord"}, {"data", activity.isNull() ? QVariant{} : QVariant(safe)}});
        finish(id); return;
    }
    if (action == "notify") { finish(id); return; }
    if (action == "exit") {
        // The shared player has already stopped its native session by now.
        // Return the saved user preferences, not reset decoder defaults.
        retainedPlayback = PlayerPolicy::playbackPreferences(args.value("playback").toMap());
        finish(id); QTimer::singleShot(0, this, &Bridge::shutdown); return;
    }
    reject(id, "Unsupported player request.");
}
void Bridge::http(const QString &id, const QVariantMap &args) {
    const auto url = args.value("url").toString();
    if (!PlayerPolicy::mediaUri(url) || requests >= 32) { reject(id, "Invalid server request."); return; }
    const auto opts = args.value("opts").toMap();
    const QByteArray method = opts.value("method", "GET").toString().toLatin1().toUpper();
    static const QSet<QByteArray> allowed = {"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"};
    if (!allowed.contains(method)) { reject(id); return; }
    QNetworkRequest request{QUrl(url)};
    // Cross-origin redirects can forward Authorization. Require the same origin.
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::SameOriginRedirectPolicy);
    request.setTransferTimeout(std::clamp(opts.value("timeout", 30000).toInt(), 1000, 120000));
    const auto headers = opts.value("headers").toMap();
    for (auto it = headers.cbegin(); it != headers.cend(); ++it) {
        const auto name = it.key().toLatin1(), value = it.value().toString().toUtf8();
        if (name.isEmpty() || name.contains('\n') || name.contains('\r') || value.contains('\n') || value.contains('\r')) { reject(id); return; }
        request.setRawHeader(name, value);
    }
    auto *reply = network.sendCustomRequest(request, method, opts.value("body").toString().toUtf8());
    ++requests;
    auto body = std::make_shared<QByteArray>();
    auto overflow = std::make_shared<bool>(false);
    connect(reply, &QIODevice::readyRead, this, [reply, body, overflow] {
        body->append(reply->readAll());
        if (body->size() > 30 * 1024 * 1024) { *overflow = true; body->clear(); reply->abort(); }
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, id, body, overflow] {
        --requests;
        body->append(reply->readAll());
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (*overflow || body->size() > 30 * 1024 * 1024 || (!status && reply->error() != QNetworkReply::NoError)) reject(id, "The server request failed.");
        else {
            QVariantMap headers;
            for (const auto &pair : reply->rawHeaderPairs()) {
                const auto name = pair.first.toLower();
                if (name == "content-type" || name == "content-length" || name == "etag" || name == "last-modified") headers[QString::fromLatin1(name)] = QString::fromUtf8(pair.second);
            }
            const auto type = reply->header(QNetworkRequest::ContentTypeHeader).toString().toLower();
            const bool binary = !type.startsWith("text/") && !type.contains("json") && !type.contains("xml") && !type.contains("javascript");
            finish(id, QVariantMap{{"ok", status >= 200 && status < 300}, {"status", status}, {"headers", headers},
                {"body", QString::fromUtf8(binary ? body->toBase64() : *body)}, {"base64", binary}});
        }
        reply->deleteLater();
    });
}

