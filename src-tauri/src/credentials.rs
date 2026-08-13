#[cfg(windows)]
use std::{ptr, slice};

pub const TARGET: &str = "MonaRadar.Company/SMINFO";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub saved: bool,
    pub username: Option<String>,
    pub credential_status: String,
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub fn save(username: &str, password: &str) -> Result<(), String> {
    save_target(TARGET,username,password)
}

#[cfg(windows)]
fn save_target(target_name:&str,username: &str, password: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{CredWriteW,CREDENTIALW,CRED_PERSIST_LOCAL_MACHINE,CRED_TYPE_GENERIC};
    if username.trim().is_empty() || password.is_empty() { return Err("ID와 Password를 모두 입력해주세요.".into()); }
    let mut target = wide(target_name);
    let mut user = wide(username.trim());
    let mut secret: Vec<u16> = password.encode_utf16().collect();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: (secret.len() * 2) as u32,
        CredentialBlob: secret.as_mut_ptr().cast::<u8>(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: user.as_mut_ptr(),
        ..Default::default()
    };
    let ok = unsafe { CredWriteW(&credential, 0) } != 0;
    secret.fill(0);
    if ok { Ok(()) } else { Err(format!("Windows Credential Manager 저장 실패: {}", std::io::Error::last_os_error())) }
}

#[cfg(windows)]
pub fn read() -> Result<Option<(String, String)>, String> {
    read_target(TARGET)
}

#[cfg(windows)]
fn read_target(target_name:&str) -> Result<Option<(String, String)>, String> {
    use windows_sys::Win32::Security::Credentials::{CredFree,CredReadW,CREDENTIALW,CRED_TYPE_GENERIC};
    let target = wide(target_name);
    let mut raw: *mut CREDENTIALW = ptr::null_mut();
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(1168) { return Ok(None); }
        return Err(format!("Windows Credential Manager 조회 실패: {error}"));
    }
    let credential = unsafe { &*raw };
    let username = unsafe {
        let mut len = 0; while *credential.UserName.add(len) != 0 { len += 1; }
        String::from_utf16_lossy(slice::from_raw_parts(credential.UserName, len))
    };
    let password = String::from_utf16_lossy(unsafe {
        slice::from_raw_parts(credential.CredentialBlob.cast::<u16>(), credential.CredentialBlobSize as usize / 2)
    });
    unsafe { CredFree(raw.cast()) };
    if username.trim().is_empty() || password.is_empty() { return Ok(None); }
    Ok(Some((username, password)))
}

#[cfg(windows)]
pub fn delete() -> Result<(), String> {
    delete_target(TARGET)
}

#[cfg(windows)]
fn delete_target(target_name:&str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW,CRED_TYPE_GENERIC};
    let target = wide(target_name);
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 { return Ok(()); }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(1168) { Ok(()) } else { Err(format!("Windows Credential Manager 삭제 실패: {error}")) }
}

#[cfg(not(windows))]
pub fn save(_: &str, _: &str) -> Result<(), String> { Err("Windows Credential Manager는 Windows에서만 지원됩니다.".into()) }
#[cfg(not(windows))]
pub fn read() -> Result<Option<(String, String)>, String> { Ok(None) }
#[cfg(not(windows))]
pub fn delete() -> Result<(), String> { Ok(()) }

#[cfg(all(test,windows))]
mod tests {
    use super::*;
    #[test]
    fn windows_credential_manager_round_trip() {
        const DIAGNOSTIC:&str="MonaRadar.Company/SMINFO/Diagnostic";
        let _=delete_target(DIAGNOSTIC);
        save_target(DIAGNOSTIC,"diagnostic-user","diagnostic-value").expect("credential write");
        let value=read_target(DIAGNOSTIC).expect("credential read").expect("credential exists");
        assert_eq!(value.0,"diagnostic-user");assert_eq!(value.1,"diagnostic-value");
        delete_target(DIAGNOSTIC).expect("credential cleanup");
        assert!(read_target(DIAGNOSTIC).expect("post-delete read").is_none());
    }
}
