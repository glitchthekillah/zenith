#pragma once
#include "mpvabstractitem.h"
#include "policy.h"
#include <QTimer>

class VideoItem : public MpvAbstractItem {
    Q_OBJECT
public:
    explicit VideoItem(QQuickItem *parent = nullptr);
    QVariantMap open(const QVariantMap &args);
    bool control(const QString &action, const QVariantMap &args);
    QVariantMap snapshot() const;
    bool initialized() const { return rendererReady; }
signals:
    void snapshotChanged(const QVariantMap &state);
    void rendererInitialized();
private:
    void publish();
    void reset();
    void submitPending();
    QString pendingUri;
    quint64 pendingGeneration = 0, flightGeneration = 0;
    bool loadInFlight = false;
    MediaEpoch epoch;
    QVariantMap state;
    bool rendererReady = false;
    QTimer ticker;
};
