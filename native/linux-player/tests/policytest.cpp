#include <QtTest>
#include "policy.h"

class PolicyTest : public QObject {
    Q_OBJECT
private slots:
    void captureRequiresBothExplicitCiFlags() {
        QVERIFY(!PlayerPolicy::diagnosticCapture("", "1"));
        QVERIFY(!PlayerPolicy::diagnosticCapture("true", ""));
        QVERIFY(!PlayerPolicy::diagnosticCapture("true", "true"));
        QVERIFY(!PlayerPolicy::diagnosticCapture("false", "1"));
        QVERIFY(PlayerPolicy::diagnosticCapture("true", "1"));
        QVERIFY(PlayerPolicy::diagnosticCapture("1", "1"));
    }
    void diagnosticMessagesPreserveLibraryErrorsWithoutUrls() {
        QCOMPARE(PlayerPolicy::diagnosticMessage("Cannot load library libqxcb.so: libxcb-cursor.so.0 missing"),
            QString("Cannot load library libqxcb.so: libxcb-cursor.so.0 missing"));
        QCOMPARE(PlayerPolicy::diagnosticMessage("Failed https://server.invalid/movie?api_key=secret; retry"),
            QString("Failed [Qt URL] retry"));
        QCOMPARE(PlayerPolicy::diagnosticMessage("Authorization: Bearer secret"),
            QString("[Private Qt diagnostic omitted]"));
    }
    void rejectsExecutableMedia() {
        QVERIFY(!PlayerPolicy::mediaUri("file:///etc/passwd"));
        QVERIFY(!PlayerPolicy::mediaUri("edl://https://example.com/movie"));
        QVERIFY(!PlayerPolicy::mediaUri("https://user:password@example.com/movie"));
        QVERIFY(PlayerPolicy::mediaUri("https://example.com/movie?api_key=secret"));
    }
    void bootstrapMustBeBoundedAndObject() {
        QVERIFY(!PlayerPolicy::bootstrap("[]").has_value());
        QVERIFY(!PlayerPolicy::bootstrap("{\"settings\":{}}").has_value());
        QVERIFY(!PlayerPolicy::bootstrap(QByteArray(4194305, 'x')).has_value());
        QVERIFY(PlayerPolicy::bootstrap(R"({"settings":{},"deviceId":"d","group":{},"item":{},"options":{"start":0,"queue":[]}})").has_value());
    }
    void retiredGenerationCannotEndReplacement() {
        MediaEpoch epoch;
        QCOMPARE(epoch.open(), quint64(1));
        epoch.started(1);
        QVERIFY(epoch.current());
        QCOMPARE(epoch.open(), quint64(2));
        QVERIFY(!epoch.current());
        epoch.started(2);
        QVERIFY(epoch.current());
        QCOMPARE(epoch.generation(), quint64(2));
        epoch.stop();
        QVERIFY(!epoch.current());
    }
    void rapidReplacementIgnoresIntermediateFile() {
        MediaEpoch epoch;
        epoch.open();
        epoch.open();
        epoch.started(1);
        QVERIFY(!epoch.current());
        epoch.started(2);
        QVERIFY(epoch.current());
    }
};
QTEST_GUILESS_MAIN(PolicyTest)
#include "policytest.moc"

