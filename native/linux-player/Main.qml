import QtQuick
import QtQuick.Window
import QtWebEngine
import Zenith.Native 1.0

Window {
    id: playerWindow
    width: 1280
    height: 720
    minimumWidth: 320
    minimumHeight: 180
    title: "Zenith"
    color: "black"
    flags: Qt.Window | Qt.FramelessWindowHint
    visible: true
    Component.onCompleted: nativeBridge.attach(movie, playerWindow)
    onClosing: function(close) {
        close.accepted = nativeBridge.exiting
        if (!close.accepted) nativeBridge.requestClose()
    }
    MpvQtVideoItem {
        id: movie
        anchors.fill: parent
        mirrorVertically: true
    }
    WebEngineView {
        id: controls
        anchors.fill: parent
        profile: trustedProfile
        webChannel: playerChannel
        url: playerEntry
        backgroundColor: "transparent"
        // Chromium and libmpv compose in the same Qt Quick OpenGL scene.
        // This separate layer matches Jellyfin's transparent WebEngine overlay.
        layer.enabled: true
        // AssetGate allows only image requests to the active Jellyfin origin.
        settings.localContentCanAccessRemoteUrls: true
        settings.localContentCanAccessFileUrls: true
        settings.javascriptCanOpenWindows: false
        settings.javascriptCanAccessClipboard: false
        settings.pluginsEnabled: false
        settings.fullScreenSupportEnabled: false
        onNavigationRequested: function(request) {
            if (!nativeBridge.trustedNavigation(request.url)) request.action = WebEngineNavigationRequest.IgnoreRequest
        }
        onLoadingChanged: function(request) {
            if (request.status === WebEngineView.LoadSucceededStatus) nativeBridge.uiLoaded(true)
            else if (request.status === WebEngineView.LoadFailedStatus) nativeBridge.uiLoaded(false)
        }
        onRenderProcessTerminated: function(terminationStatus, exitCode) { nativeBridge.uiLoaded(false) }
        onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID) {}
    }
}
