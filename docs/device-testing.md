# 실기기 빌드 및 녹음 검증

## 현재 상태와 선행 조건

- Expo SDK 57 프로젝트다. `whisper.rn`, `react-native-audio-api` 등 사용자 정의 네이티브 모듈을 포함하므로 Expo Go가 아닌 앱 자체 빌드로 검증한다.
- **개발 빌드의 선행 조건이 아직 충족되지 않았다.** `developmentClient: true`는 `expo-dev-client`에 의존하지만 현재 `package.json`과 `node_modules`에 없다. 별도 의존성 변경 작업에서 `npx expo install expo-dev-client`로 SDK 호환 버전을 준비한 뒤 아래 절차를 진행한다. 이번 설정 작업에서는 설치하지 않았다. 근거: [EAS 개발 프로필](https://docs.expo.dev/build/eas-json/#development-builds).
- Expo 계정과 EAS 프로젝트 접근 권한이 필요하다. iOS 실기기에는 Apple Developer 계정, 서명에 포함된 기기 UDID, 개발자 모드가 필요하다. [iOS 실기기 공식 절차](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/).
- 아래 명령은 테스트 담당자가 실행할 절차이며, 이번 작업에서는 로그인·원격 빌드·실기기 설치를 실행하지 않았다. `npx eas-cli@latest`는 로컬 캐시에 CLI가 없으면 다운로드할 수 있다.

## EAS 빌드와 설치

1. 저장소에서 로그인한다.

   ```bash
   cd /Users/lsmman/claude/voicenote
   npx eas-cli@latest login
   ```

2. 현재 `app.json`에는 `extra.eas.projectId`가 없다. 최초 사용 시 아래 명령으로 올바른 계정의 프로젝트에 연결한다. 이 명령은 `app.json`을 갱신하므로 연결 결과를 확인한다. 이미 연결돼 있다면 생략한다. [EAS 프로젝트 연결](https://docs.expo.dev/tutorial/eas/configure-development-build/).

   ```bash
   npx eas-cli@latest init
   ```

3. iPhone은 빌드 전에 기기를 등록한다. CLI가 제공한 등록 URL을 해당 기기에서 열고 안내를 완료한다.

   ```bash
   npx eas-cli@latest device:create
   ```

4. 필요한 플랫폼 명령을 실행한다. `development`는 내부 배포이며 `ios.simulator: false`로 실기기를 대상으로 한다. 서명 및 등록 기기 선택은 EAS 안내를 따른다.

   ```bash
   npx eas-cli@latest build --profile development --platform ios
   npx eas-cli@latest build --profile development --platform android
   ```

5. 빌드 완료 페이지의 설치 링크/QR을 휴대전화에서 연다. Android는 APK를 내려받아 해당 브라우저의 앱 설치를 허용하고 설치한다. iOS는 등록한 기기에서 설치하고 개발자 모드를 활성화한다. 설치 실패 시 기기 UDID가 프로비저닝 프로필에 포함됐는지 확인한다.

6. 컴퓨터와 휴대전화를 같은 네트워크에 연결하고 개발 서버를 실행한다. 설치한 개발 클라이언트에서 QR 또는 서버 URL을 연다. 마이크 권한과 Android 알림 권한 요청을 확인한다.

   ```bash
   npx expo start --dev-client
   ```

   앱 설정이나 네이티브 의존성이 바뀌면 새 빌드를 설치한다. [개발 빌드 실행](https://docs.expo.dev/develop/development-builds/use-development-builds/).

7. 강제 종료 후 오프라인 재실행·장시간 테스트는 Metro 의존성을 배제하도록 `preview` 빌드에서도 반복한다. Android는 APK이며 JS가 포함된 내부 배포 빌드다. `production`은 기본 스토어 배포 프로필이다.

   ```bash
   npx eas-cli@latest build --profile preview --platform ios
   npx eas-cli@latest build --profile preview --platform android
   ```

## 백그라운드 녹음 설정 근거

설치된 소스를 기준으로 확인했다. 경로는 저장소 루트 기준이다.

- `node_modules/expo-audio/plugin/build/withAudio.js:8-40`: 정확한 옵션은 `microphonePermission`, `recordAudioAndroid`, `enableBackgroundRecording`, `enableBackgroundPlayback`이다. 녹음은 켜고 재생은 끈다. iOS `UIBackgroundModes`에 `audio`를 넣고 마이크 설명을 설정한다. Android에는 `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`을 추가한다.
- 같은 파일 `:72-77`: `expo.modules.audio.service.AudioRecordingService`를 `android:exported="false"`, `android:foregroundServiceType="microphone"`으로 추가한다.
- `node_modules/react-native-audio-api/app.plugin.js`가 연결하는 `lib/commonjs/plugin/withAudioAPI.js:9-18,152-159`: 기본값은 `iosBackgroundMode: true`, `androidForegroundService: true`이고 미디어 재생용 권한도 추가한다. 현재는 두 옵션을 `false`, `androidPermissions`를 `[]`로 명시했다. 권한 추가는 서비스 옵션과 별개이므로 빈 배열도 필요하다.
- 기존 `enableBackgroundRecording` 이름은 이미 맞았다. 수동으로 중복 기재한 iOS 배경 모드·마이크 설명과 Android 권한 4개를 제거했다. `WAKE_LOCK`은 위 플러그인이 추가하지 않으므로 기존 수동 선언을 유지했다.

## 설정 검증 결과

2026-10-13 다음 명령은 종료 코드 0이었다. Xcode 없이 확인한 config mod 결과이며, 컴파일된 앱의 최종 manifest 병합이나 실기기 동작을 검증한 것은 아니다.

```bash
npx expo config --type introspect --json
```

실제 출력의 `_internal.modResults.ios.infoPlist`에서 관련 항목 발췌:

```json
{
  "UIBackgroundModes": ["audio"],
  "NSMicrophoneUsageDescription": "회의와 강의를 녹음하기 위해 마이크를 사용합니다."
}
```

`_internal.modResults.android.manifest.manifest["uses-permission"]`에서 관련 항목 발췌:

```json
[
  {"$": {"android:name": "android.permission.RECORD_AUDIO"}},
  {"$": {"android:name": "android.permission.MODIFY_AUDIO_SETTINGS"}},
  {"$": {"android:name": "android.permission.POST_NOTIFICATIONS"}},
  {"$": {"android:name": "android.permission.FOREGROUND_SERVICE"}},
  {"$": {"android:name": "android.permission.FOREGROUND_SERVICE_MICROPHONE"}}
]
```

`_internal.modResults.android.manifest.manifest.application[0].service` 전체:

```json
[
  {
    "$": {
      "android:name": "expo.modules.audio.service.AudioRecordingService",
      "android:exported": "false",
      "android:foregroundServiceType": "microphone"
    }
  }
]
```

## 수동 테스트 체크리스트

아래는 합격 여부를 확인할 항목이며 **모두 실기기 미검증**이다. iOS와 Android 각각 기기/OS, 빌드 ID·프로필, 시작·종료 시각, 배터리·저장 공간, 결과 및 로그를 기록한다. 앱에 기능이 없거나 기준을 만족하지 못하면 미구현/실패로 기록한다.

- [ ] **잠금 화면 3시간 녹음:** 화면이 열린 상태에서 권한을 허용하고 녹음을 시작한 뒤 잠근다. 3시간 후 잠금을 풀고 저장한다. 파일 길이와 시작/중간/끝 구간을 재생해 누락·무음·손상을 확인하고 전사 가능 여부를 기록한다. Android 녹음 알림, 배터리 소모와 발열도 확인한다.
- [ ] **전화 수신 중단:** 녹음 중 다른 전화로 전화를 걸어 수신·통화·종료한다. 중단 상태가 표시되는지, 통화 전 파일이 보존되는지, 통화 종료 후 자동 또는 사용자 조작으로 녹음을 재개할 수 있는지 확인한다. 통화 구간 누락과 재개 시점을 기록한다.
- [ ] **녹음 중 앱 종료 후 복구:** 녹음 도중 최근 앱 화면에서 종료한 뒤 다시 연다. Android 설정의 강제 종료도 별도 실행한다. 복구 가능한 저장 구간과 손실된 마지막 구간을 기록하고, 복구 파일 재생·전사 및 중복 레코드 여부를 확인한다. 프로세스 종료 뒤에도 녹음이 계속될 것이라고 가정하지 않는다.
- [ ] **비행기 모드와 업로드 큐:** 녹음/파일을 준비한 뒤 비행기 모드를 켜고 Wi-Fi도 끈다. 업로드 요청이 대기 상태로 남는지 확인한다. 앱을 재실행해 큐가 유지되는지 확인하고, 연결 복원 후 재개·완료·중복 업로드 여부를 확인한다. 오프라인 재실행은 preview 빌드에서 검사한다.
- [ ] **파일 가져오기와 전사:** 알려진 음성이 있는 m4a/mp3/wav 파일을 각각 선택한다. 가져오기, 길이/재생, 전사 완료 및 실제 발화와의 일치 여부를 기록한다. 형식별 실패를 별도로 남긴다.
- [ ] **모델 다운로드 재개:** 모델 다운로드 중 진행률을 기록하고 네트워크를 끊었다가 복원한다. 이어받기 여부를 실제 전송량/로그로 확인한다. 앱 종료·재실행도 반복하고, 완료된 모델로 전사를 수행해 불완전 파일을 완료로 처리하지 않는지 확인한다.

설정 통과만으로 위 동작을 보장하지 않는다. 런타임 녹음 모드·중단 처리·복구·큐·모델 다운로드 구현 및 네이티브 모듈 빌드 호환성은 이번 설정 감사의 검증 범위 밖이다.
