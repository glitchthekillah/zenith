//! Bounded PCM output owned by the Zenith process, not a WebView2 utility process.
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc, Arc, Mutex};

struct Output { id: u64, tx: mpsc::SyncSender<(u64, Vec<i16>)>, stop: Arc<AtomicBool>, epoch: Arc<AtomicU64> }
#[derive(Default, Clone)]
pub struct Audio(Arc<Mutex<Option<Output>>>, Arc<AtomicU64>);
pub fn reserve(state: &Audio) -> u64 { state.1.fetch_add(1, Ordering::AcqRel) + 1 }

pub fn close(state: &Audio, id: u64) {
    let mut output = state.0.lock().unwrap();
    if output.as_ref().is_some_and(|o| o.id == id) {
        if let Some(old) = output.take() { old.stop.store(true, Ordering::Release); }
    }
}
pub fn flush(state: &Audio, id: u64, generation: u64) {
    if let Some(o) = state.0.lock().unwrap().as_ref().filter(|o| o.id == id) { o.epoch.fetch_max(generation, Ordering::AcqRel); }
}
pub fn write(state: &Audio, id: u64, generation: u64, samples: Vec<i16>) -> bool {
    if samples.is_empty() || samples.len() > 8192 || samples.len() % 2 != 0 { return false; }
    let output = state.0.lock().unwrap();
    let Some(o) = output.as_ref().filter(|o| o.id == id) else { return false; };
    if generation != o.epoch.load(Ordering::Acquire) { return false; }
    o.tx.try_send((generation, samples)).is_ok()
}

#[cfg(test)]
pub fn open(state: &Audio, rate: u32) -> Result<u64, String> { open_reserved(state, rate, reserve(state)) }
pub fn open_reserved(state: &Audio, rate: u32, ticket: u64) -> Result<u64, String> {
    if state.1.load(Ordering::Acquire) != ticket { return Err("Audio startup superseded".into()); }
    if !(8000..=96000).contains(&rate) { return Err("Unsupported audio sample rate".into()); }
    #[cfg(not(windows))]
    { let _ = state; Err("Native audio output is only needed on Windows".into()) }
    #[cfg(windows)]
    {
        let mut output = state.0.lock().unwrap();
        if state.1.load(Ordering::Acquire) != ticket { return Err("Audio startup superseded".into()); }
        if let Some(old) = output.take() { old.stop.store(true, Ordering::Release); }
        let id = ticket;
        let (tx, rx) = mpsc::sync_channel(8);
        let (ready, ack) = mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false)); let epoch = Arc::new(AtomicU64::new(0));
        let (stop2, epoch2) = (stop.clone(), epoch.clone());
        std::thread::spawn(move || windows_output::run(rate, rx, ready, stop2, epoch2));
        match ack.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) if state.1.load(Ordering::Acquire) == ticket => { *output = Some(Output {id, tx, stop, epoch}); Ok(id) }
            _ => { stop.store(true, Ordering::Release); Err("Windows audio output could not be opened".into()) }
        }
    }
}

#[cfg(windows)]
mod windows_output {
    use super::*;
    use std::{collections::VecDeque, mem, ptr, time::Duration};
    use windows_sys::Win32::Media::Audio::*;
    #[repr(align(8))]
    struct Header(WAVEHDR);
    struct Buffer { header: Box<Header>, _samples: Vec<i16> }
    unsafe fn retire(handle: HWAVEOUT, buffer: Buffer) -> bool {
        // The driver must release a prepared header before its allocation is freed.
        if waveOutUnprepareHeader(handle, ptr::addr_of!(buffer.header.0).cast_mut(), mem::size_of::<WAVEHDR>() as u32) != 0 { mem::forget(buffer); return false; }
        true
    }
    unsafe fn clear(handle: HWAVEOUT, pending: &mut VecDeque<Buffer>) -> bool {
        if waveOutReset(handle) != 0 { return false; }
        while let Some(buffer) = pending.pop_front() { if !retire(handle, buffer) { return false; } }
        true
    }
    pub fn run(rate: u32, rx: mpsc::Receiver<(u64, Vec<i16>)>, ready: mpsc::SyncSender<Result<(), ()>>, stop: Arc<AtomicBool>, epoch: Arc<AtomicU64>) {
        unsafe {
            let format = WAVEFORMATEX {wFormatTag: 1, nChannels: 2, nSamplesPerSec: rate, nAvgBytesPerSec: rate * 4, nBlockAlign: 4, wBitsPerSample: 16, cbSize: 0};
            let mut handle = ptr::null_mut();
            if waveOutOpen(&mut handle, WAVE_MAPPER, &format, 0, 0, 0) != 0 { let _ = ready.send(Err(())); return; }
            let _ = ready.send(Ok(()));
            let mut pending: VecDeque<Buffer> = VecDeque::new(); let mut current_epoch = 0;
            'render: while !stop.load(Ordering::Acquire) {
                let next_epoch = epoch.load(Ordering::Acquire);
                if next_epoch != current_epoch {
                    if !clear(handle, &mut pending) { break; }
                    current_epoch = next_epoch;
                }
                while pending.front().is_some_and(|b| ptr::read_volatile(ptr::addr_of!(b.header.0.dwFlags)) & WHDR_DONE != 0) {
                    if !retire(handle, pending.pop_front().unwrap()) { break 'render; }
                }
                match rx.recv_timeout(Duration::from_millis(5)) {
                    Ok((packet_epoch, mut samples)) => {
                        if packet_epoch != current_epoch { continue; }
                        // Bound driver latency after a stalled UI/IPC thread. Never grow a backlog.
                        if pending.len() >= 6 && !clear(handle, &mut pending) { break; }
                        let header = Box::new(Header(WAVEHDR {lpData: samples.as_mut_ptr().cast(), dwBufferLength: (samples.len()*2) as u32, dwBytesRecorded: 0, dwUser: 0, dwFlags: 0, dwLoops: 0, lpNext: ptr::null_mut(), reserved: 0}));
                        let mut buffer = Buffer {header, _samples: samples};
                        let hdr = ptr::addr_of_mut!(buffer.header.0);
                        if waveOutPrepareHeader(handle, hdr, mem::size_of::<WAVEHDR>() as u32) != 0 { break; }
                        if waveOutWrite(handle, hdr, mem::size_of::<WAVEHDR>() as u32) != 0 { retire(handle, buffer); break; }
                        pending.push_back(buffer);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {},
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            if !clear(handle, &mut pending) { for buffer in pending { mem::forget(buffer); } }
            let _ = waveOutClose(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packets_are_bounded_and_generation_scoped() {
        let state = Audio::default(); let (tx, rx) = mpsc::sync_channel(1);
        *state.0.lock().unwrap() = Some(Output {id: 7, tx, stop: Arc::new(AtomicBool::new(false)), epoch: Arc::new(AtomicU64::new(0))});
        assert!(!write(&state, 6, 0, vec![0; 2])); assert!(!write(&state, 7, 0, vec![0; 8194])); assert!(!write(&state, 7, 0, vec![0; 3]));
        assert!(write(&state, 7, 0, vec![0; 2048])); assert!(!write(&state, 7, 0, vec![0; 2048])); assert_eq!(rx.recv().unwrap().0, 0);
        flush(&state, 7, 1); assert!(!write(&state, 7, 0, vec![0; 2])); assert!(write(&state, 7, 1, vec![0; 2])); assert_eq!(rx.recv().unwrap().0, 1);
        close(&state, 6); assert!(write(&state, 7, 1, vec![0; 2])); let _ = rx.recv(); close(&state, 7); assert!(!write(&state, 7, 0, vec![0; 2]));
    }
    #[test]
    fn stale_open_is_rejected_before_touching_the_device() { let state = Audio::default(); let old = reserve(&state); let _new = reserve(&state); assert!(open_reserved(&state, 48000, old).unwrap_err().contains("superseded")); }
    #[test]
    fn invalid_sample_rates_are_rejected() { assert!(open(&Audio::default(), 0).is_err()); assert!(open(&Audio::default(), 192000).is_err()); }
    #[cfg(windows)]
    #[test]
    #[ignore = "requires an actual Windows output device; writes silence only"]
    fn windows_output_smoke() {
        let state = Audio::default(); let id = open(&state, 48000).unwrap();
        assert!(write(&state, id, 0, vec![0; 2048])); std::thread::sleep(std::time::Duration::from_millis(60)); flush(&state, id, 1); close(&state, id);
    }
}
