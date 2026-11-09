// Saved sign-in cookies are encrypted with the Windows account (DPAPI), like Electron's
// safeStorage did. On Linux the file is only readable by the user.

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe {
            if protect {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
            }
        };
        if ok == 0 || out.pbData.is_null() { return None; }
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Some(v)
    }
    pub fn protect(d: &[u8]) -> Vec<u8> { run(d, true).map(|mut v| { v.insert(0, b'D'); v }).unwrap_or_else(|| d.to_vec()) }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> {
        match d.first() { Some(b'D') => run(&d[1..], false), Some(b'{') => Some(d.to_vec()), _ => None }
    }
    pub fn private(_p: &std::path::Path) {}
}

#[cfg(not(windows))]
mod imp {
    pub fn protect(d: &[u8]) -> Vec<u8> { d.to_vec() }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
    pub fn private(p: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
    }
}

pub use imp::*;
