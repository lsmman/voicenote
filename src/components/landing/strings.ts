import type { Language } from '../../i18n/language';

type Copy = {
  eyebrow: string; headline: string; intro: string; start: string; signin: string; noAccount: string;
  featuresTitle: string; features: { title: string; body: string }[];
  howTitle: string; steps: { title: string; body: string }[];
  privacyTitle: string; privacy: string; mcpTitle: string; mcp: string; docs: string; docsError: string;
  closing: string; closingBody: string; preview: string; previewTitle: string; saved: string;
  transcript: string; quote: string; summary: string; summaryText: string; bookmark: string; footer: string;
};
export const strings: Record<Language, Copy> = {
  en: {
    eyebrow: 'BE PRESENT. KEEP EVERY WORD.', headline: 'Good conversations.\nClear next steps.',
    intro: 'Turn meetings, lectures, and passing ideas into notes you can actually use. Just press record. Voicenote takes it from there.',
    start: 'Start recording', signin: 'Sign in to sync', noAccount: 'Start on your device. No account required.',
    featuresTitle: 'From the first word to the next idea.',
    features: [
      { title: 'Room for the whole conversation', body: 'Long recordings, automatic chunk saves, and crash recovery. Keep recording in the background on mobile; keep the tab open on web.' },
      { title: 'Catch the moment', body: 'Add memos and bookmarks while you record. Return to the exact moment that mattered.' },
      { title: 'Your words, in writing', body: 'Accurate on-device Whisper transcription with timestamps. Audio stays on your device for transcription.' },
      { title: 'Find the point, faster', body: 'AI summaries, keywords, to-dos, and automatic titles turn a long conversation into a clear plan.' },
      { title: 'Pick up on another device', body: 'Sign in to sync your notes across devices, so your work is ready wherever you are.' },
      { title: 'Bring it in. Take it with you.', body: 'Upload existing audio files, or export your recordings as M4A to listen and share.' },
    ],
    howTitle: 'Less note-taking. More listening.',
    steps: [ { title: 'Record or upload', body: 'Capture a new conversation or bring an audio file.' }, { title: 'Make it readable', body: 'Whisper transcribes on your device, with timestamps to follow along.' }, { title: 'Move things forward', body: 'Generate an AI summary and turn the next steps into action.' } ],
    privacyTitle: 'Transcription stays close to home.', privacy: 'Whisper processes audio on your device for transcription. AI summaries send transcript text to a cloud AI service. Signing in enables cloud sync; you can start locally without an account.',
    mcpTitle: 'Your notes have more to say.', mcp: 'Connect Voicenote to AI assistants through MCP (Model Context Protocol). Bring your saved conversations into your next question, idea, or workflow.', docs: 'Explore AI integrations', docsError: 'Could not open the guide. Please try again.',
    closing: 'Give your next idea a place to land.', closingBody: 'A meeting, a lecture, a thought worth keeping. Start with your voice.',
    preview: 'EXAMPLE NOTE', previewTitle: 'A small idea, a clear plan', saved: 'Saved on device', transcript: 'TRANSCRIPT', quote: 'Let’s make the first version simple, then share it with the team on Friday.', summary: 'AI SUMMARY', summaryText: 'Keep the first version focused.\nTo-do: share with the team on Friday.', bookmark: 'Key moment bookmarked', footer: 'Voicenote · Make room for listening.',
  },
  ko: {
    eyebrow: '대화에 집중하세요. 기록은 남겨둘게요.', headline: '좋은 대화가\n분명한 다음 단계로.',
    intro: '회의, 강의, 문득 떠오른 생각을 다시 꺼내 쓸 수 있는 노트로. 녹음 버튼만 누르세요. 정리는 Voicenote가 도와드릴게요.',
    start: '녹음 시작하기', signin: '로그인하고 동기화', noAccount: '계정 없이, 내 기기에서 바로 시작하세요.',
    featuresTitle: '첫마디부터 다음 아이디어까지.',
    features: [
      { title: '긴 대화도 든든하게', body: '장시간 녹음, 구간별 자동 저장, 중단 후 복구까지. 모바일에서는 백그라운드 녹음을 지원해요. 웹에서는 탭을 열어두세요.' },
      { title: '중요한 순간을 놓치지 않게', body: '녹음 중 메모와 북마크를 남기세요. 필요한 순간으로 정확하게 돌아갈 수 있어요.' },
      { title: '목소리가 글이 되는 순간', body: '기기 내 Whisper로 정확하게 전사하고 타임스탬프를 남겨요. 전사를 위해 오디오를 외부로 보내지 않아요.' },
      { title: '핵심을 더 빠르게', body: 'AI 요약, 키워드, 할 일, 자동 제목으로 긴 대화를 명확한 계획으로 정리하세요.' },
      { title: '다른 기기에서도 이어서', body: '로그인하면 기기 간 노트가 동기화돼요. 어디서든 내 기록을 이어서 확인하세요.' },
      { title: '가져오고, 내보내고', body: '기존 오디오 파일을 업로드하거나 녹음을 M4A로 내보내 듣고 공유하세요.' },
    ],
    howTitle: '적는 시간은 줄이고, 듣는 시간은 늘리고.',
    steps: [ { title: '녹음하거나 업로드', body: '새로운 대화를 담거나 기존 오디오 파일을 가져오세요.' }, { title: '읽을 수 있는 기록으로', body: 'Whisper가 기기에서 전사하고 타임스탬프를 붙여줘요.' }, { title: '다음 행동으로 연결', body: 'AI 요약으로 핵심을 확인하고 할 일을 실행하세요.' } ],
    privacyTitle: '전사는 내 기기 안에서.', privacy: 'Whisper는 기기에서 오디오를 전사해요. AI 요약을 요청하면 전사 텍스트가 클라우드 AI 서비스로 전송돼요. 로그인하면 클라우드 동기화를 사용할 수 있으며, 계정 없이 로컬에서 시작할 수도 있어요.',
    mcpTitle: '내 노트, AI와 함께 더 넓게.', mcp: 'MCP(Model Context Protocol)로 Voicenote를 AI 어시스턴트와 연결하세요. 저장한 대화를 다음 질문, 아이디어, 업무에 활용해 보세요.', docs: 'AI 연동 가이드 보기', docsError: '가이드를 열지 못했어요. 다시 시도해 주세요.',
    closing: '다음 아이디어가 머물 곳.', closingBody: '회의도, 강의도, 기억하고 싶은 생각도. 목소리로 시작하세요.',
    preview: '노트 예시', previewTitle: '작은 아이디어, 명확한 계획', saved: '기기에 저장됨', transcript: '전사', quote: '첫 버전은 간단하게 만들고, 금요일에 팀에 공유하면 좋겠어요.', summary: 'AI 요약', summaryText: '첫 버전은 핵심에 집중하기.\n할 일: 금요일에 팀에 공유하기.', bookmark: '중요한 순간 북마크', footer: 'Voicenote · 듣는 데 집중하세요.',
  },
  zh: {
    eyebrow: '专注倾听，留住每一句话。', headline: '让精彩对话\n成为清晰的下一步。',
    intro: '把会议、课堂和一闪而过的灵感变成真正有用的笔记。只需开始录音，Voicenote 帮你整理。',
    start: '开始录音', signin: '登录并同步', noAccount: '无需账号，即可在设备上开始。',
    featuresTitle: '从第一句话，到下一个灵感。',
    features: [
      { title: '长时间录音，安心记录', body: '支持长时间录音、分段自动保存和意外中断恢复。移动端支持后台录音；网页端请保持标签页打开。' },
      { title: '抓住重要时刻', body: '录音时添加备忘和书签，随时回到关键时刻。' },
      { title: '让声音成为文字', body: '设备端 Whisper 提供准确的转写和时间戳。转写时，音频始终留在你的设备上。' },
      { title: '快速掌握重点', body: 'AI 摘要、关键词、待办事项和自动标题，让长对话变成清晰的计划。' },
      { title: '换个设备，继续使用', body: '登录后即可跨设备同步笔记，随时随地接着处理。' },
      { title: '轻松导入，随心带走', body: '上传已有音频文件，或将录音导出为 M4A，方便收听和分享。' },
    ],
    howTitle: '少一点忙着记，多一点认真听。',
    steps: [ { title: '录音或上传', body: '记录新的对话，或导入已有音频文件。' }, { title: '转成可读的笔记', body: 'Whisper 在设备上完成转写，并附上时间戳。' }, { title: '把想法变成行动', body: '生成 AI 摘要，明确重点并落实下一步。' } ],
    privacyTitle: '转写，就在你的设备上。', privacy: 'Whisper 在设备上处理音频转写。生成 AI 摘要时，转写文本会发送到云端 AI 服务。登录可启用云同步，也可以无需账号从本地开始。',
    mcpTitle: '让笔记与 AI 一起发挥更多价值。', mcp: '通过 MCP（模型上下文协议）将 Voicenote 连接到 AI 助手，让保存的对话融入下一个问题、灵感或工作流程。', docs: '查看 AI 集成指南', docsError: '无法打开指南，请重试。',
    closing: '给下一个灵感，一个落脚点。', closingBody: '一场会议、一堂课、一个值得留住的想法。从你的声音开始。',
    preview: '笔记示例', previewTitle: '小小灵感，清晰计划', saved: '已保存在设备上', transcript: '转写', quote: '我们先把第一个版本做简单一点，周五再分享给团队。', summary: 'AI 摘要', summaryText: '第一个版本专注于核心功能。\n待办：周五分享给团队。', bookmark: '已标记关键时刻', footer: 'Voicenote · 留出空间，专注倾听。',
  },
};
export function docsPath(language: Language): string {
  return language === 'en' ? '/docs' : `/docs/${language}`;
}
