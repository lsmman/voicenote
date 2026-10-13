# voicenote

장시간 녹음을 놓치지 않고 받아 적는 음성 노트 앱. 폰이나 브라우저에서 녹음하거나
오디오 파일을 가져오면 기기 안에서 텍스트로 전사한다. 녹음 중에 남긴 메모는
녹음 시각에 묶이고, 전사가 끝나면 요약, 할 일, 키워드까지 뽑아 준다.

1단계 범위는 녹음·전사, 녹음 중 메모, AI 요약·키워드다(화자 분리는 2단계). Expo 하나로 iOS·Android·웹을 만들고, 전사는 기기 안 Whisper로 한다.

기획 메모: [docs/voicenote.md](docs/voicenote.md) · 설계: [docs/superpowers/specs/2026-10-13-voicenote-design.md](docs/superpowers/specs/2026-10-13-voicenote-design.md)
