#include <glib-object.h>
#include <dlfcn.h>
#include <stdio.h>
static void *pipeline, *bus;
static gint frames;
static GMainLoop *loop;
static gint64 started;
static int status=1;
static int (*query_position)(void*,int,gint64*);
static void *(*pop_error)(void*,unsigned);
static void (*parse_error)(void*,GError**,char**);
static void handoff(void *sink,void *buffer,void *pad,void *data){g_atomic_int_inc(&frames);}
static gboolean poll(void *data){
  void *message=pop_error(bus,2);
  if(message){GError *e=NULL;char *debug=NULL;parse_error(message,&e,&debug);fprintf(stderr,"FAIL native decode: %s\n",e?e->message:"unknown");if(e)g_error_free(e);g_free(debug);g_main_loop_quit(loop);return FALSE;}
  gint64 pos=0;query_position(pipeline,3,&pos);
  if(frames>5 && pos>2000000000){printf("PASS native decoded %d frames at %.3f seconds\n",frames,pos/1e9);status=0;g_main_loop_quit(loop);return FALSE;}
  if(g_get_monotonic_time()-started>30000000){fprintf(stderr,"FAIL native decode timeout, frames=%d position=%f\n",frames,pos/1e9);g_main_loop_quit(loop);return FALSE;}
  return TRUE;
}
int main(int argc,char **argv){
  void *lib=dlopen("libgstreamer-1.0.so.0",RTLD_NOW|RTLD_GLOBAL);if(!lib)return 2;
  void (*init)(int*,char***)=dlsym(lib,"gst_init");
  void *(*launch)(const char*,GError**)=dlsym(lib,"gst_parse_launch");
  void *(*get_bus)(void*)=dlsym(lib,"gst_element_get_bus");
  int (*state)(void*,int)=dlsym(lib,"gst_element_set_state");
  void (*unref)(void*)=dlsym(lib,"gst_object_unref");
  query_position=dlsym(lib,"gst_element_query_position");pop_error=dlsym(lib,"gst_bus_pop_filtered");parse_error=dlsym(lib,"gst_message_parse_error");
  init(&argc,&argv);GError *error=NULL;
  pipeline=launch("playbin3 video-sink=\"fakesink name=frames sync=true signal-handoffs=true\" audio-sink=pulsesink",&error);
  if(error||!pipeline){fprintf(stderr,"FAIL native pipeline creation\n");return 2;}
  g_object_set(pipeline,"uri",g_getenv("ZENITH_PROBE_MEDIA_URL"),NULL);
  void *sink=NULL;g_object_get(pipeline,"video-sink",&sink,NULL);g_signal_connect(sink,"handoff",G_CALLBACK(handoff),NULL);unref(sink);
  bus=get_bus(pipeline);loop=g_main_loop_new(NULL,FALSE);started=g_get_monotonic_time();state(pipeline,4);g_timeout_add(200,poll,NULL);g_main_loop_run(loop);
  state(pipeline,1);unref(bus);unref(pipeline);g_main_loop_unref(loop);return status;
}
