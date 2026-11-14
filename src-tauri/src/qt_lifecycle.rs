//! Session ownership shared by the Linux player process lifecycle.
pub struct SessionSlot<T> { next: u64, live: Option<(u64, T)> }
impl<T> Default for SessionSlot<T> { fn default() -> Self { Self { next: 0, live: None } } }
impl<T> SessionSlot<T> {
    pub fn claim(&mut self, value: T) -> (u64, Option<T>) {
        self.next = self.next.checked_add(1).expect("player session counter exhausted");
        let previous = self.live.replace((self.next, value)).map(|(_, value)| value);
        (self.next, previous)
    }
    pub fn current(&self, id: u64) -> bool { self.live.as_ref().is_some_and(|(owner, _)| *owner == id) }
    pub fn value(&self) -> Option<&T> { self.live.as_ref().map(|(_, value)| value) }
    pub fn can_restore(&self, id: u64) -> bool { self.next == id && self.live.is_none() }
    pub fn finish(&mut self, id: u64) -> bool {
        if !self.current(id) { return false; }
        self.live = None;
        true
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn late_exit_cannot_restore_over_replacement_player() {
        let mut slot = SessionSlot::default();
        let (old, _) = slot.claim("old");
        let (new, previous) = slot.claim("new");
        assert_eq!(previous, Some("old"));
        assert!(!slot.finish(old));
        assert_eq!(slot.value(), Some(&"new"));
        assert!(slot.current(new));
    }
    #[test] fn only_live_owner_can_finish_once() {
        let mut slot = SessionSlot::default();
        let (id, _) = slot.claim(42);
        assert!(!slot.finish(id + 1));
        assert!(slot.finish(id));
        assert!(!slot.finish(id));
        assert_eq!(slot.value(), None);
    }
    #[test] fn queued_restore_loses_authority_when_a_new_session_is_claimed() {
        let mut slot = SessionSlot::default();
        let (old, _) = slot.claim("old");
        assert!(slot.finish(old));
        assert!(slot.can_restore(old));
        let (new, _) = slot.claim("new");
        assert!(!slot.can_restore(old));
        assert!(slot.finish(new));
        assert!(!slot.can_restore(old));
        assert!(slot.can_restore(new));
    }
}
