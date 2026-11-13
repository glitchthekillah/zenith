/* Diagnostic only: reproduce the documented early Xlib initialization without
 * rebuilding an older candidate. The shipped app calls this from Rust startup. */
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
extern int XInitThreads(void);
__attribute__((constructor)) static void initialize_xlib_threads(void) {
    /* AppRun can be a launcher/interpreter. Preserve the probe until exec
     * reaches Zenith itself, then remove it before any WebKit child starts. */
    char executable[4096];
    ssize_t size = readlink("/proc/self/exe", executable, sizeof(executable)-1);
    if (size < 0) return;
    executable[size] = '\0';
    const char *name = strrchr(executable, '/');
    name = name ? name+1 : executable;
    if (strcmp(name, "zenith") != 0) return;
    if (!XInitThreads()) abort();
    const char message[] = "Zenith early XInitThreads diagnostic initialized\n";
    write(2, message, sizeof(message)-1);
    unsetenv("LD_PRELOAD"); /* do not change any child WebKit process */
}
