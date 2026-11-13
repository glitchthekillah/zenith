/* Diagnostic only: reproduce the documented early Xlib initialization without
 * rebuilding an older candidate. The shipped app calls this from Rust startup. */
#include <stdlib.h>
extern int XInitThreads(void);
__attribute__((constructor)) static void initialize_xlib_threads(void) {
    if (!XInitThreads()) abort();
    unsetenv("LD_PRELOAD"); /* do not change any child WebKit process */
}
