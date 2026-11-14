#pragma once
#include <QJsonDocument>
#include <QJsonObject>
#include <QQueue>
#include <QUrl>
#include <QRegularExpression>
#include <optional>

namespace PlayerPolicy {
constexpr qsizetype maxLine = 4 * 1024 * 1024;
inline bool diagnosticCapture(const QString &ci, const QString &diagnostics) {
    return (ci == "true" || ci == "1") && diagnostics == "1";
}
inline QString diagnosticMessage(QString message) {
    static const QRegularExpression url(R"(https?://[^\s"'<>]+)", QRegularExpression::CaseInsensitiveOption);
    message.replace(url, "[Qt URL]");
    for (const QString &secret : {"api_key", "token", "authorization"})
        if (message.contains(secret, Qt::CaseInsensitive)) return "[Private Qt diagnostic omitted]";
    return message.left(2048);
}
inline bool mediaUri(const QString &value) {
    QUrl url(value, QUrl::StrictMode);
    return url.isValid() && (url.scheme() == "http" || url.scheme() == "https")
        && !url.host().isEmpty() && url.userInfo().isEmpty() && !value.contains(QChar::Null)
        && !value.contains('\n') && !value.contains('\r');
}
inline std::optional<QVariantMap> bootstrap(const QByteArray &line) {
    if (line.size() > maxLine) return std::nullopt;
    QJsonParseError error;
    auto doc = QJsonDocument::fromJson(line, &error);
    if (error.error || !doc.isObject()) return std::nullopt;
    const auto o = doc.object();
    if (!o.value("settings").isObject() || !o.value("group").isObject()
        || !o.value("item").isObject() || !o.value("options").isObject()
        || !o.value("deviceId").isString()) return std::nullopt;
    return o.toVariantMap();
}
}
// START_FILE events are ordered by libmpv. Properties/end events before the
// replacement starts belong to the retired file, even if open() already replied.
class MediaEpoch {
public:
    quint64 open() { return ++requested; }
    void started(quint64 generation) { active = generation; }
    void stop() { active = 0; ++requested; }
    bool current() const { return active != 0 && active == requested; }
    quint64 generation() const { return requested; }
private:
    quint64 active = 0, requested = 0;
};
