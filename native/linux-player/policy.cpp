#include "policy.h"
#include <QRegularExpression>

QString PlayerPolicy::diagnosticMessage(QString message) {
    static const QRegularExpression url(R"(https?://[^\s"'<>]+)", QRegularExpression::CaseInsensitiveOption);
    message.replace(url, "[Qt URL]");
    for (const QString &secret : {"api_key", "token", "authorization"})
        if (message.contains(secret, Qt::CaseInsensitive)) return "[Private Qt diagnostic omitted]";
    return message.left(2048);
}
