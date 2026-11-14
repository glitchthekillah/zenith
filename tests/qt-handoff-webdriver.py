"""Exercise a packaged Tauri host's actual bundled Qt helper lifecycle.

Run inside the prepared X11/dbus/Pulse CI session, once per package:
  CI=true ZENITH_QT_HOST_APPLICATION=/absolute/AppRun python3 tests/qt-handoff-webdriver.py
  CI=true ZENITH_QT_HOST_APPLICATION=/usr/bin/zenith python3 tests/qt-handoff-webdriver.py
Requires tauri-driver, WebKitWebDriver and Node 22. No Python/npm CDP dependency.
"""
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


assert os.environ.get("CI") in ("true", "1"), "Packaged helper diagnostics require CI"
application = pathlib.Path(os.environ["ZENITH_QT_HOST_APPLICATION"]).resolve()
assert application.is_file() and os.access(application, os.X_OK), application
fixture = pathlib.Path("/tmp/zenith-media-fixtures/video.mkv")
assert fixture.is_file(), "Generate the shared blue H264/AC3 fixture first"
artifacts = pathlib.Path(os.environ.get("ZENITH_QT_HANDOFF_ARTIFACTS", "/tmp/zenith-qt-handoff"))
artifacts.mkdir(parents=True, exist_ok=True)
requests = []
failures = []
source = {
    "Id": "blue", "Container": "mkv", "SupportsDirectPlay": True,
    "DefaultAudioStreamIndex": 1, "DefaultSubtitleStreamIndex": -1,
    "MediaStreams": [
        {"Index": 0, "Type": "Video", "Codec": "h264", "Width": 640, "Height": 360},
        {"Index": 1, "Type": "Audio", "Codec": "ac3", "Language": "eng", "Channels": 6, "IsDefault": True},
    ],
}


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass  # Request URLs can carry synthetic auth; record only safe fields.

    def handle_request(self):
        from urllib.parse import urlsplit, parse_qs
        url = urlsplit(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        data = json.loads(body) if body else None
        entry = {"path": url.path, "method": self.command, "body": data, "time": time.monotonic()}
        if self.headers.get("Range"):
            entry["range"] = self.headers["Range"]
        requests.append(entry)
        if re.fullmatch(r"/Videos/[^/]+/stream", url.path):
            if parse_qs(url.query).get("static") != ["true"]:
                failures.append("Non-static original media request")
            size = fixture.stat().st_size
            start, end, status = 0, size - 1, 200
            range_header = self.headers.get("Range")
            if range_header:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
                if match and any(match.groups()):
                    a, b = match.groups()
                    start = int(a) if a else max(0, size - int(b))
                    end = min(size - 1, int(b)) if a and b else size - 1
                if not match or not any(match.groups()) or start >= size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
            self.send_response(status)
            self.send_header("Content-Type", "video/x-matroska")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if self.command != "HEAD":
                try:
                    with fixture.open("rb") as media:
                        media.seek(start)
                        remaining = end - start + 1
                        while remaining:
                            chunk = media.read(min(65536, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # libmpv legitimately cancels ranges during replacement.
            return
        result = {"Items": [], "Valid": False}
        if url.path.endswith("/PlaybackInfo"):
            if not (data and data.get("EnableTranscoding") is False and
                    data.get("EnableDirectStream") is False and
                    data.get("DeviceProfile", {}).get("TranscodingProfiles") == []):
                failures.append("Playback negotiation allowed server conversion")
            item_id = url.path.split("/")[2]
            result = {"MediaSources": [source], "PlaySessionId": "handoff-" + item_id}
        elif url.path == "/Users/fixture":
            result = {"Id": "fixture", "Name": "CI fixture", "Policy": {"EnableMediaPlayback": True}}
        elif "Transcod" in url.path or ".m3u8" in url.path:
            failures.append("Server conversion requested")
        encoded = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)

    do_GET = handle_request
    do_HEAD = handle_request
    do_POST = handle_request


server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
group = {"id": "handoff-fixture", "name": "Packaged helper fixture", "servers": {
    "jellyfin": {"url": f"http://127.0.0.1:{server.server_port}", "token": "synthetic-handoff-token", "userId": "fixture"}}}


def payload(item_id):
    return {"settings": {"groups": [group], "playback": {"volume": 1, "rate": 1, "subtitles": "off", "autoplayNext": False},
                         "app": {"discord": False, "notify": False}},
            "deviceId": "handoff-fixture-device", "group": group,
            "item": {"Id": item_id, "Name": "Packaged handoff " + item_id, "Type": "Movie", "RunTimeTicks": 600000000,
                     "MediaSources": [source], "UserData": {}}, "options": {"start": 0, "queue": []}}


def request(method, route, data=None):
    port = 4445 if route.startswith("/session/") else 4444
    encoded = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}" + route, data=encoded, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as response:
        result = json.load(response)
    value = result.get("value", result)
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError(value)
    return value


NODE_CDP = r"""
import assert from 'node:assert/strict';
const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const page=targets.find(t=>t.type==='page'&&t.url.includes('qt-player.html'));
assert(page,'Missing bundled Qt player CDP target');
const socket=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
try {
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Bundled Qt CDP timed out')),10000);
    socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id===1){clearTimeout(timer);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}});
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{const q=window.zenithQt;const s=await q.call('diagnostic.state');const v=document.querySelector('#player video');return {...s,backend:q.backend,url:location.href,time:v?.currentTime,width:v?.videoWidth,paused:v?.paused,error:!!v?.error}})()`}}));
  });
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result.result.value));
}finally{socket.close();}
"""


def qt_snapshot():
    completed = subprocess.run(["node", "--input-type=module", "-e", NODE_CDP], check=False,
                               capture_output=True, text=True, timeout=15)
    assert completed.returncode == 0, "Bundled Qt CDP probe failed: " + completed.stderr[-3000:]
    return json.loads(completed.stdout)


environment = os.environ.copy()
environment.update(CI="true", ZENITH_QT_DIAGNOSTICS="1", QTWEBENGINE_REMOTE_DEBUGGING="127.0.0.1:9223")
driver_log = (artifacts / "tauri-driver.log").open("w")
driver = subprocess.Popen(["tauri-driver"], stdout=driver_log, stderr=subprocess.STDOUT, env=environment, start_new_session=True)
session = None
active_ids = []
observations = []

try:
    deadline = time.monotonic() + 15
    while True:
        assert driver.poll() is None, "tauri-driver exited during startup"
        try:
            request("GET", "/status")
            break
        except (urllib.error.URLError, http.client.RemoteDisconnected):
            assert time.monotonic() < deadline, "tauri-driver startup timed out"
            time.sleep(.1)
    created = request("POST", "/session", {"capabilities": {"alwaysMatch": {
        "browserName": "wry", "tauri:options": {"application": str(application)}}}})
    session = created["sessionId"]
    base = "/session/" + session
    request("POST", base + "/timeouts", {"script": 30000})

    def js(code):
        return request("POST", base + "/execute/sync", {"script": code, "args": []})

    def async_js(code):
        script = "const done=arguments[arguments.length-1];(async()=>{" + code + "})().then(value=>done({value}),e=>done({error:String(e),stack:e.stack}));"
        result = request("POST", base + "/execute/async", {"script": script, "args": []})
        assert "error" not in result, result
        return result.get("value")

    def until(check, label, timeout=40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = check()
            if result:
                return result
            time.sleep(.15)
        raise AssertionError("Timed out: " + label)

    until(lambda: js("return !!window.__TAURI__?.core && !!window.__TAURI__?.event && !!document.body"), "Tauri bridge")
    # Await listener registration before any session can emit a close event.
    async_js("""
      window.handoffEvents=[];
      await window.__TAURI__.event.listen('zenith',async event=>{
        if(event.payload?.channel!=='qt-player-closed')return;
        const w=window.__TAURI__.window.getCurrentWindow();
        const data=event.payload.data;
        window.handoffEvents.push({...data,visible:await w.isVisible(),focused:await w.isFocused()});
      });return true;
    """)

    def parent():
        return async_js("const w=window.__TAURI__.window.getCurrentWindow();return {visible:await w.isVisible(),focused:await w.isFocused()};")

    def closed(session_id):
        return js("return window.handoffEvents.find(e=>e.id===" + json.dumps(session_id) + ")||null")

    def start(item_id):
        began = time.monotonic()
        result = async_js("return await window.__TAURI__.core.invoke('qt_play',{payload:" + json.dumps(payload(item_id)) + "});")
        assert result.get("id") is not None, result
        assert time.monotonic() - began < 5, "qt_play waited for playback instead of returning its session id"
        active_ids.append(result["id"])
        return result["id"]

    def close(session_id):
        async_js("await window.__TAURI__.core.invoke('qt_close',{id:" + json.dumps(session_id) + "});return true;")

    def stopped(item_id):
        return next((r for r in requests if r["path"] == "/Sessions/Playing/Stopped" and
                     (r.get("body") or {}).get("ItemId") == item_id), None)

    assert parent()["visible"], "Browsing host started hidden"
    first = start("first")
    # Native ready is authoritative; DOM presence alone cannot authorize hiding.
    until(lambda: not parent()["visible"], "parent hidden after helper readiness")
    snapshot = qt_snapshot()
    assert snapshot["ready"] is True and snapshot["visible"] is True, snapshot
    assert snapshot["backend"] == "qt-mpv", snapshot
    assert "/player-assets/qt-player.html" in snapshot["url"], "Helper loaded repository assets instead of packaged resource assets"
    until(lambda: (qt_snapshot().get("width") or 0) == 640, "actual bundled movie metadata")
    before = qt_snapshot()
    def advancing():
        current = qt_snapshot()
        observations.append({"case": "startup-progress", "state": current})
        assert not current["error"], current
        return current if not current["paused"] and current["time"] > before["time"] + .5 else None
    after = until(advancing, "packaged movie advances after startup", timeout=20)
    observations.append({"case": "bundled-ready", "before": before, "after": after})
    close(first)
    event = until(lambda: closed(first), "matching first close event")
    assert not event.get("error"), event
    assert event["visible"], "Host was not restored when close event arrived"
    until(lambda: parent()["visible"] and parent()["focused"], "host visibility and focus restored")
    report = until(lambda: stopped("first"), "real helper stopped report")
    assert report["body"]["PositionTicks"] > 5000000, report
    print("PASS packaged Qt handoff, native readiness, real movie progress, stopped position and focus restoration", flush=True)

    old = start("old")
    until(lambda: not parent()["visible"], "replacement source ready")
    ready = qt_snapshot()
    assert ready["ready"] and ready["visible"], ready
    until(lambda: (qt_snapshot().get("width") or 0) == 640, "old movie opened")
    time.sleep(1.2)
    new = start("new")
    assert new != old, "Replacement reused an old session id"
    old_event = until(lambda: closed(old), "retired helper close event")
    assert old_event["visible"] is False, "Late old helper exit restored the browser over its replacement"
    assert not parent()["visible"], "Replacement handoff revealed browsing host"
    # Two helpers may briefly compete for the one CI CDP port. Verify the new
    # actual helper through its own Jellyfin session rather than reattaching to
    # a stale old debugger or pretending DOM state belongs to the new process.
    until(lambda: any(r["path"] == "/Sessions/Playing" and (r.get("body") or {}).get("ItemId") == "new" for r in requests), "replacement actual playback start")
    # The new helper has a fresh decoder/audio device. Its start event precedes
    # actual playback, so a fixed short sleep is not evidence of elapsed media.
    until(lambda: any(r["path"] == "/Sessions/Playing/Progress" and
                      (r.get("body") or {}).get("ItemId") == "new" and
                      (r.get("body") or {}).get("PositionTicks", 0) > 5000000
                      for r in requests), "replacement actual decoded progress", timeout=25)
    close(old)  # A stale owner must not be able to close the active helper.
    time.sleep(.5)
    assert closed(new) is None, "Stale qt_close terminated the replacement"
    assert not parent()["visible"], "Stale qt_close restored browsing over the replacement"
    close(new)
    new_event = until(lambda: closed(new), "replacement close event")
    assert not new_event.get("error"), new_event
    until(lambda: parent()["visible"] and parent()["focused"], "replacement final restoration")
    new_report = until(lambda: stopped("new"), "replacement stopped report")
    assert new_report["body"]["PositionTicks"] > 5000000, new_report
    assert stopped("old"), "Retired helper did not report stopped playback"
    observations.append({"case": "replacement", "old": old_event, "new": new_event})
    assert any("range" in entry for entry in requests), "Bundled libmpv did not use byte ranges"
    assert failures == [], failures
    print("PASS rapid replacement ignores retired close events and stale session commands", flush=True)
finally:
    prior_failure = sys.exc_info()[0] is not None
    cleanup_failures = []
    if session:
        try:
            for session_id in active_ids:
                async_js("await window.__TAURI__.core.invoke('qt_close',{id:" + json.dumps(session_id) + "});return true;")
            (artifacts / "host-events.json").write_text(json.dumps(js("return window.handoffEvents||[]"), indent=2))
        except Exception as error:
            cleanup_failures.append(str(error))
        finally:
            try:
                request("DELETE", "/session/" + session)
            except Exception as error:
                cleanup_failures.append(str(error))
    try:
        os.killpg(driver.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        driver.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(driver.pid, signal.SIGKILL)
        driver.wait()
    driver_log.close()
    server.shutdown()
    server.server_close()
    (artifacts / "requests.json").write_text(json.dumps(requests, indent=2))
    (artifacts / "observations.json").write_text(json.dumps(observations, indent=2))
    if cleanup_failures:
        print("Handoff cleanup errors: " + "; ".join(cleanup_failures), file=sys.stderr)
        if not prior_failure:
            raise AssertionError("Packaged host cleanup failed")
