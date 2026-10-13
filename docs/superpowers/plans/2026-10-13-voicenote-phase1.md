# voicenote 1단계 구현 계획

> **For agentic workers:** 각 작업은 아래 "소유 경로"만 만들고 고친다. 계약 파일(`src/core/*`, `src/*/types.ts`, `src/services.ts`, `package.json`, `app.json`)은 읽기 전용이다. 계약이 맞지 않으면 고치지 말고 보고서에 적는다.

**Goal:** 스펙(`docs/superpowers/specs/2026-10-13-voicenote-design.md`)의 1단계를 Expo 앱 + Supabase + Vercel 함수로 구현한다.

**Architecture:** 모듈별 인터페이스(`types.ts`)를 먼저 고정하고, 플랫폼별 구현은 `index.ts`(웹·tsc 기본) / `index.native.ts`(iOS·Android)로 나눈다. UI는 `src/services.ts`만 import 한다.

**Tech Stack:** Expo SDK 57, expo-router, expo-audio, expo-sqlite, idb, whisper.rn, @huggingface/transformers, Supabase, @anthropic-ai/sdk (`claude-opus-5-5`), zod, jest-expo.

## 공통 규칙

- Expo API는 기억에 의존하지 말고 `https://docs.expo.dev/versions/v57.0.0/` 문서를 확인한다 (AGENTS.md).
- 새 패키지 설치 금지. 필요하면 보고서에 적는다.
- 순수 로직은 jest 테스트를 쓴다: `npx jest <자기 경로>`.
- 타입 검사: `npx tsc --noEmit` — 다른 작업자의 진행 중 파일 오류는 무시하고 자기 소유 경로의 오류만 0으로 만든다.
- 커밋하지 않는다. 메인 스레드가 검증 후 커밋한다.
- 오디오 위치 규칙: 네이티브 `${FileSystem documentDirectory}recordings/${noteId}/${seq}.m4a`, 웹 IndexedDB blob 키 `${noteId}/${seq}` (`store.putAudioBlob`).

## 작업 (병렬)

| # | 작업 | 소유 경로 |
|---|---|---|
| 1 | 로컬 저장소 | `src/store/index.ts`, `src/store/index.native.ts`, `src/store/**` (types.ts 제외), `src/store/__tests__/` |
| 2 | 파이프라인 | `src/pipeline/**` (types.ts 제외) |
| 3 | 녹음기 | `src/recorder/**` (types.ts 제외) |
| 4 | 전사 엔진 | `src/transcriber/**` (types.ts 제외) |
| 5 | 백엔드·동기화·배포 | `supabase/**`, `api/**`, `src/sync/**` (types.ts 제외), `vercel.json`, `.env.example` |
| 6 | 화면 | `src/app/**`, `src/components/**`, `src/ui/**` |

각 작업의 상세 지시는 디스패치 프롬프트에 있다. 완료 조건:

1. 소유 경로의 tsc 오류 0
2. 순수 로직 테스트 통과 (작업 1, 2, 4의 병합 로직, 5의 요약 응답 파싱)
3. 보고서에 만든 파일 목록과 계약 불일치 사항

## 통합 (메인 스레드)

1. 전체 `npx tsc --noEmit`, `npx jest` 통과
2. `npx expo export --platform web` 성공
3. 커밋, Vercel 배포 (`vercel` CLI; 환경 변수는 사용자에게 받음)
4. 실기기 3시간 녹음·CER 측정은 사용자 환경에서 별도 진행 (EAS 개발 빌드 필요)

## 스펙 대비 조정

- 파일 가져오기는 30초로 자르지 않고 단일 청크로 저장한다. 네이티브에서 m4a/mp3를 디코딩 없이 자를 수 없고, Whisper 엔진이 긴 파일을 내부에서 30초 창으로 처리하기 때문.
