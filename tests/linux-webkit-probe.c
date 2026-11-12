#include <webkit2/webkit2.h>
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
static int outcome = 1, busy = 0, polls = 0;
static void result(GObject *object, GAsyncResult *async, gpointer unused) {
  GError *error = NULL;
  WebKitJavascriptResult *r = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), async, &error);
  if (r) {
    char *s = jsc_value_to_string(webkit_javascript_result_get_js_value(r));
    if (g_str_has_prefix(s, "PASS ") || g_str_has_prefix(s, "FAIL ")) {
      puts(s); fflush(stdout); outcome = g_str_has_prefix(s, "PASS ") ? 0 : 1; gtk_main_quit();
    }
    if (polls % 25 == 0) { puts(s); fflush(stdout); }
    g_free(s); webkit_javascript_result_unref(r);
  }
  if (error) { fprintf(stderr, "%s\n", error->message); g_error_free(error); }
  busy = 0;
}
static gboolean tick(gpointer view) {
  if (++polls > 150) { fputs("FAIL playback timeout\n", stderr); gtk_main_quit(); return FALSE; }
  if (!busy) {
    busy = 1;
    webkit_web_view_run_javascript(WEBKIT_WEB_VIEW(view), "(()=>{const v=document.querySelector('video');if(!v)return 'WAIT';const s={width:v.videoWidth,time:v.currentTime,ready:v.readyState,network:v.networkState,paused:v.paused,error:v.error?.code,message:v.error?.message,playError:window.playError,audio:v.webkitAudioDecodedByteCount};return (v.error||window.playError?'FAIL ':v.videoWidth&&v.currentTime>2?'PASS ':'WAIT ')+JSON.stringify(s)})()", NULL, result, NULL);
  }
  return TRUE;
}
int main(int argc, char **argv) {
  void *gst = dlopen("libgstreamer-1.0.so.0", RTLD_NOW | RTLD_LOCAL);
  void (*gst_init_runtime)(int *, char ***) = gst ? dlsym(gst, "gst_init") : NULL;
  void *(*find_factory)(const char *) = gst ? dlsym(gst, "gst_element_factory_find") : NULL;
  void (*unref_factory)(void *) = gst ? dlsym(gst, "gst_object_unref") : NULL;
  if (!gst_init_runtime || !find_factory || !unref_factory) { fputs("FAIL cannot inspect packaged GStreamer runtime\n", stderr); return 2; }
  gst_init_runtime(&argc, &argv);
  const char *required[] = {"avdec_h264", "avdec_ac3", "matroskademux", "qtdemux", "souphttpsrc", "pulsesink", "glupload", "glcolorconvert"};
  for (unsigned i = 0; i < sizeof(required) / sizeof(required[0]); i++) {
    void *factory = find_factory(required[i]);
    if (!factory) { fprintf(stderr, "FAIL missing packaged GStreamer element: %s\n", required[i]); return 2; }
    unref_factory(factory);
  }
  gtk_init(&argc, &argv);
  WebKitWebsitePolicies *policies = webkit_website_policies_new_with_policies("autoplay", WEBKIT_AUTOPLAY_ALLOW, NULL);
  GtkWidget *view = g_object_new(WEBKIT_TYPE_WEB_VIEW, "website-policies", policies, NULL);
  g_object_unref(policies);
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_default_size(GTK_WINDOW(window), 640, 360);
  gtk_container_add(GTK_CONTAINER(window), view); gtk_widget_show_all(window);
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), g_getenv("ZENITH_PROBE_URL"));
  g_timeout_add(200, tick, view); gtk_main();
  return outcome;
}
