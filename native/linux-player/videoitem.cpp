#include "videoitem.h"
#include <cmath>
#include <algorithm>
#include <cstdio>

VideoItem::VideoItem(QQuickItem *parent) : MpvAbstractItem(parent) {
    const bool ciDiagnostics = PlayerPolicy::diagnosticCapture(qEnvironmentVariable("CI"), qEnvironmentVariable("ZENITH_QT_DIAGNOSTICS"));
    if (ciDiagnostics) std::fprintf(stderr, "Qt startup: upstream MpvAbstractItem constructor returned\n");
    reset();
    // All options are applied on MpvQt's worker. Never subscribe to or print mpv
    // log messages: HTTP errors can contain the complete authenticated URI.
    setProperty("vo", "libmpv");
    setProperty("terminal", false);
    setProperty("msg-level", "all=no");
    setProperty("input-default-bindings", false);
    setProperty("input-vo-keyboard", false);
    setProperty("load-scripts", false);
    setProperty("access-references", false);
    setProperty("load-unsafe-playlists", false);
    setProperty("demuxer-lavf-o", "protocol_whitelist=[http,https,tcp,tls,crypto]");
    setProperty("video-timing-offset", 0);
    setProperty("keep-open", false);
    setProperty("hwdec", "auto-safe");
    setProperty("idle", true);
    connect(this, &MpvAbstractItem::ready, this, [this] {
        if (PlayerPolicy::diagnosticCapture(qEnvironmentVariable("CI"), qEnvironmentVariable("ZENITH_QT_DIAGNOSTICS")))
            std::fprintf(stderr, "Qt startup: MpvQt renderer ready\n");
        rendererReady = true;
        emit rendererInitialized();
    });
    connect(mpvController(), &MpvController::fileStarted, this, [this] {
        epoch.started(flightGeneration);
        loadInFlight = false;
        submitPending();
    });
    connect(mpvController(), &MpvController::fileLoaded, this, [this] {
        if (!epoch.current()) return;
        state["buffering"] = false;
        publish();
    });
    connect(mpvController(), &MpvController::endFile, this, [this](const QString &reason) {
        if (!epoch.current()) return;
        state["buffering"] = false;
        if (reason == "eof") { state["ended"] = true; state["paused"] = true; }
        else if (reason == "error") { state["error"] = "Original-file playback failed."; state["paused"] = true; }
        // A manual stop/replacement must never turn into a natural end event.
        publish();
    });
    connect(mpvController(), &MpvController::propertyChanged, this,
        [this](const QString &property, const QVariant &value) {
        if (!epoch.current() || !value.isValid()) return;
        static const QMap<QString, QString> names = {
            {"time-pos", "currentTime"}, {"duration", "duration"}, {"width", "width"}, {"height", "height"},
            {"pause", "paused"}, {"paused-for-cache", "buffering"}, {"mute", "muted"}, {"speed", "rate"}
        };
        if (names.contains(property)) state[names[property]] = value;
        else if (property == "volume") state["volume"] = value.toDouble() / 100.0;
        else if (property == "track-list") {
            QVariantList tracks;
            for (const auto &entry : value.toList()) {
                auto t = entry.toMap();
                QString type = t.value("type").toString();
                if (type != "audio" && type != "sub" && type != "video") continue;
                const auto id = t.value("id").toString();
                tracks.append(QVariantMap{{"id", id}, {"kind", type == "sub" ? "subtitle" : type},
                    {"label", t.value("title", t.value("lang", type + " " + id))},
                    {"language", t.value("lang", "")}, {"selected", t.value("selected", false)}});
            }
            state["tracks"] = tracks;
        }
    });
    // MPV_FORMAT_NODE is important for unavailable properties (NONE) and track-list.
    for (const QString &name : {"time-pos", "duration", "width", "height", "pause", "paused-for-cache", "volume", "mute", "speed", "track-list"})
        observeProperty(name, MPV_FORMAT_NODE);
    ticker.setInterval(100);
    connect(&ticker, &QTimer::timeout, this, [this] { if (epoch.current()) publish(); });
    ticker.start();
    if (ciDiagnostics) std::fprintf(stderr, "Qt startup: VideoItem constructor returned\n");
}
void VideoItem::reset() {
    state = {{"currentTime", 0.0}, {"duration", 0.0}, {"width", 0}, {"height", 0},
        {"paused", true}, {"buffering", true}, {"ended", false}, {"volume", 1.0},
        {"muted", false}, {"rate", 1.0}, {"tracks", QVariantList{}}};
}
QVariantMap VideoItem::snapshot() const {
    auto result = state;
    result["generation"] = QVariant::fromValue(epoch.generation());
    return result;
}
void VideoItem::publish() { emit snapshotChanged(snapshot()); }
QVariantMap VideoItem::open(const QVariantMap &args) {
    const auto generation = epoch.open();
    reset();
    state["volume"] = std::clamp(args.value("volume", 1).toDouble(), 0.0, 1.0);
    state["muted"] = args.value("muted", false).toBool();
    state["rate"] = std::clamp(args.value("rate", 1).toDouble(), 0.25, 4.0);
    setProperty("volume", state["volume"].toDouble() * 100);
    setProperty("mute", state["muted"]);
    setProperty("speed", state["rate"]);
    setProperty("pause", false);
    pendingUri = args.value("uri").toString();
    pendingGeneration = generation;
    submitPending();
    publish();
    return {{"generation", QVariant::fromValue(generation)}};
}
void VideoItem::submitPending() {
    if (loadInFlight || pendingUri.isEmpty()) return;
    loadInFlight = true;
    flightGeneration = pendingGeneration;
    command({"loadfile", pendingUri, "replace"});
    pendingUri.clear();
}
bool VideoItem::control(const QString &action, const QVariantMap &args) {
    const auto number = args.value(action == "media.seek" ? "position" : "value").toDouble();
    if (!std::isfinite(number)) return false;
    if (action == "media.play") { setProperty("pause", false); state["paused"] = false; }
    else if (action == "media.pause") { setProperty("pause", true); state["paused"] = true; }
    else if (action == "media.seek") {
        if (number < 0) return false;
        state["ended"] = false;
        command({"seek", QString::number(number, 'f', 6), "absolute+exact"});
    } else if (action == "media.rate") {
        if (number < 0.25 || number > 4) return false;
        setProperty("speed", number);
    } else if (action == "media.volume") {
        if (number < 0 || number > 1) return false;
        setProperty("volume", number * 100);
        setProperty("mute", args.value("muted", false));
    } else if (action == "media.track") {
        const auto kind = args.value("kind").toString();
        if (kind != "audio" && kind != "subtitle") return false;
        const auto id = args.value("id").toString();
        bool numeric = false; id.toUInt(&numeric);
        if (!id.isEmpty() && !numeric) return false;
        setProperty(kind == "audio" ? "aid" : "sid", id.isEmpty() ? "no" : id);
    } else if (action == "media.stop") {
        epoch.stop(); pendingUri.clear(); command({"stop"}); reset(); state["buffering"] = false;
    } else if (action == "media.fit") {
        const auto mode = args.value("mode").toString();
        if (mode != "contain" && mode != "cover") return false;
        setProperty("panscan", mode == "cover" ? 1.0 : 0.0);
    } else return false;
    publish();
    return true;
}
