#pragma once
#include <QObject>
#include <QNetworkAccessManager>
#include <QQuickWindow>
#include <QRect>
#include <QUrl>
#include "videoitem.h"

class Bridge : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool exiting READ exiting NOTIFY exitingChanged)
public:
    Bridge(QVariantMap bootstrap, QUrl entry, QObject *parent = nullptr);
    bool exiting() const { return closing; }
    Q_INVOKABLE void attach(QObject *video, QObject *window);
    Q_INVOKABLE void uiLoaded(bool success);
    Q_INVOKABLE bool trustedNavigation(const QUrl &url) const;
    Q_INVOKABLE void requestClose();
    Q_INVOKABLE void mediaKey(const QString &key);
    Q_INVOKABLE void shutdown();
    static void output(const QVariantMap &event);
public slots:
    void request(const QString &id, const QString &action, const QVariantMap &args);
signals:
    void completed(const QString &id, const QVariantMap &result);
    void event(const QString &channel, const QVariantMap &data);
    void exitingChanged();
private:
    void finish(const QString &id, const QVariant &result = QVariantMap{});
    void reject(const QString &id, const QString &message = "Player request failed.");
    void checkReady();
    void http(const QString &id, const QVariantMap &args);
    QVariantMap windowState() const;
    QVariantMap bootstrapData;
    QUrl entryUrl;
    VideoItem *video = nullptr;
    QQuickWindow *window = nullptr;
    QNetworkAccessManager network;
    bool bootstrapped = false, loaded = false, sentReady = false, closing = false, closeRequested = false;
    bool mini = false, pinned = false;
    QRect normalGeometry;
    int requests = 0;
};
