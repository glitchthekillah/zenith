#include "policy.h"
#include <QRegularExpression>
#include <cmath>

QVariantMap PlayerPolicy::playbackPreferences(const QVariantMap &values) {
    QVariantMap result;
    const QMap<QString, QPair<double, double>> ranges{{"volume", {0, 1}}, {"rate", {0.25, 4}}, {"subtitleSize", {60, 200}}};
    for (auto it = ranges.cbegin(); it != ranges.cend(); ++it) {
        bool valid = false;
        const double value = values.value(it.key()).toDouble(&valid);
        if (valid && std::isfinite(value) && value >= it.value().first && value <= it.value().second) result[it.key()] = value;
    }
    for (const QString &key : {"subtitles", "audioLang", "subLang"}) {
        const QString value = values.value(key).toString();
        static const QRegularExpression safe("^[A-Za-z0-9_-]{0,32}$");
        if (values.contains(key) && safe.match(value).hasMatch()) result[key] = value;
    }
    return result;
}

QString PlayerPolicy::diagnosticMessage(QString message) {
    static const QRegularExpression url(R"(https?://[^\s"'<>]+)", QRegularExpression::CaseInsensitiveOption);
    message.replace(url, "[Qt URL]");
    for (const QString &secret : {"api_key", "token", "authorization"})
        if (message.contains(secret, Qt::CaseInsensitive)) return "[Private Qt diagnostic omitted]";
    return message.left(2048);
}
