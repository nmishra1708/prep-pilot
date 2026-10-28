import type {
  AnswerRecord,
  CategoryName,
  CategoryReport,
  InterviewQuestion,
} from "./types";

export interface AudioMetrics {
  averageLevel: number;
  levelVariation: number;
  estimatedPitchVariation: number;
  longPauseSeconds: number;
  paceSamples: Array<{ seconds: number; wordsPerMinute: number }>;
}

export interface ScoringInput {
  question: InterviewQuestion;
  transcript: string;
  durationMs: number;
  timeLimitSeconds: number;
  firstWordSeconds: number | null;
  audio?: AudioMetrics;
}

export interface Marker {
  seconds: number;
  kind: "filler" | "pause" | "pace";
  label: string;
}

const fillerPattern = /\b(?:um+|uh+|erm|like|you know|basically)\b/gi;
const hedgePattern = /\b(?:I think maybe|perhaps|sort of|kind of|I guess)\b/gi;
const wordPattern = /\b[\p{L}\p{N}'-]+\b/gu;

export function detectFillers(text: string): Array<{ word: string; index: number }> {
  return [...text.matchAll(fillerPattern)].map((match) => ({
    word: match[0],
    index: match.index ?? 0,
  }));
}

export function calcPace(wordCount: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.round((wordCount / durationMs) * 60_000);
}

export function detectPauses(
  audio: Pick<AudioMetrics, "longPauseSeconds"> | undefined,
  durationSeconds: number,
): Array<{ seconds: number; durationSeconds: number }> {
  if (!audio || audio.longPauseSeconds <= 0) return [];
  return [{ seconds: Math.max(0, durationSeconds / 2), durationSeconds: audio.longPauseSeconds }];
}

export function checkSTAR(text: string, behavioural: boolean): {
  missing: string[];
  present: string[];
} {
  const lower = text.toLowerCase();
  const parts: Array<[string, RegExp]> = behavioural
    ? [
      ["Situation", /\b(?:when|while|during|at my|in my|there was)\b/],
      ["Task", /\b(?:responsible|task|goal|needed to|asked to|my role)\b/],
      ["Action", /\b(?:i (?:did|built|led|created|decided|worked|implemented|coordinated|changed)|we (?:implemented|created|decided))\b/],
      ["Result", /\b(?:result|outcome|improved|reduced|increased|saved|learned|impact)\b/],
    ]
    : [
      ["Context", /\b(?:context|requirement|problem|constraint|goal|because)\b/],
      ["Approach", /\b(?:approach|I would|we use|implemented|design|first)\b/],
      ["Trade-off", /\b(?:trade.off|tradeoff|trade off|cost|however|instead|versus|vs\.)\b/],
      ["Result", /\b(?:result|measure|metric|outcome|verify|impact)\b/],
    ];
  const present = parts.filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  return { present, missing: parts.filter(([name]) => !present.includes(name)).map(([name]) => name) };
}

function level(score: number): "Low" | "Medium" | "High" {
  return score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";
}

function evidence(seconds: number, label: string, detail: string) {
  return [{ seconds: Math.max(0, Math.round(seconds)), label, detail }];
}

export function scoreAnswer(input: ScoringInput): CategoryReport[] {
  const clean = input.transcript.trim();
  const words = clean.match(wordPattern) ?? [];
  const seconds = input.durationMs / 1000;
  const pace = calcPace(words.length, input.durationMs);
  const fillers = detectFillers(clean);
  const hedges = [...clean.matchAll(hedgePattern)];
  const repetitions = [...clean.matchAll(/\b(\w+)(?:\s+\1\b)+/gi)];
  const jargon = [...clean.matchAll(/\b(?:API|SLA|SLO|CRUD|JWT|RAG|LLM|ETL)\b/g)].filter(
    (match) => !/\b(?:means|stands for|which is|that is)\b/i.test(clean.slice(match.index, match.index + 60)),
  );
  const weakOpening = /^(?:um+|uh+|so|maybe|I think|I guess)\b/i.test(clean);
  const unfinished = Boolean(clean) && !/[.!?]$/.test(clean);
  const rubric = input.question.rubric;
  const lower = clean.toLowerCase();
  const foundPoints = rubric.filter((point) =>
    point.toLowerCase().split(/\s+/).some((term) => term.length > 4 && lower.includes(term)),
  );
  const accuracyScore = rubric.length ? Math.round((foundPoints.length / rubric.length) * 100) : 50;
  const fillerRate = words.length ? (fillers.length / words.length) * 100 : 0;
  const sentenceCount = (clean.match(/[.!?]+/g) ?? []).length;
  const averageSentenceWords = sentenceCount ? words.length / sentenceCount : words.length;
  const communicationScore = Math.max(
    0,
    Math.min(100, Math.round(100 - fillerRate * 6 - hedges.length * 7 - repetitions.length * 8
      - jargon.length * 5 - (weakOpening ? 5 : 0) - Math.max(0, averageSentenceWords - 28) * 1.5)),
  );
  const limitRatio = input.timeLimitSeconds > 0 ? seconds / input.timeLimitSeconds : 0;
  const baseTimeScore = clean.length === 0 ? 0
    : limitRatio > 2 ? 35
      : seconds < 30 ? 45
        : limitRatio > 1 ? Math.max(45, Math.round(100 - (limitRatio - 1) * 35))
          : Math.min(100, Math.round(75 + Math.min(limitRatio, 1) * 25));
  const timeScore = Math.max(0, baseTimeScore - (unfinished ? 8 : 0));
  const audio = input.audio;
  const voiceScore = audio
    ? Math.max(0, Math.min(100, Math.round(
      72 + Math.min(pace, 170) / 10 - Math.max(0, pace - 170) / 4
      - audio.longPauseSeconds * 2
      - Math.max(0, audio.levelVariation - 0.12) * 90
      - (audio.estimatedPitchVariation < 0.025 ? 8 : 0),
    )))
    : Math.max(0, Math.min(100, Math.round(75 - Math.max(0, pace - 170) / 4)));
  const framing = checkSTAR(clean, input.question.type === "behavioural");
  const framingScore = Math.round(((4 - framing.missing.length) / 4) * 100);
  const firstWord = input.firstWordSeconds;
  const markerTime = (index: number) => {
    if (!words.length || seconds <= 0) return 0;
    return Math.max(0, Math.round((index / words.length) * seconds));
  };
  const firstFiller = fillers[0];
  const paceAverage = audio?.paceSamples.length
    ? audio.paceSamples.reduce((sum, item) => sum + item.wordsPerMinute, 0) / audio.paceSamples.length
    : pace;
  const paceSpikes = audio?.paceSamples.filter((item) => item.wordsPerMinute > Math.max(180, paceAverage * 1.35)) ?? [];
  const pauseMarkers = detectPauses(audio, seconds);
  const nervousnessScore = Math.max(0, Math.min(100, Math.round(
    90 - fillers.length * 5 - hedges.length * 5 - (audio?.longPauseSeconds ?? 0) * 2 - paceSpikes.length * 6
    - Math.max(0, pace - 180) * 0.15,
  )));
  const parts: Array<[CategoryName, number, string, string, string[]]> = [
    [
      "Answer accuracy", accuracyScore,
      `${foundPoints.length} of ${rubric.length} rubric points matched by keyword heuristic.`,
      foundPoints.length < rubric.length ? `Address these rubric points explicitly: ${rubric.filter((point) => !foundPoints.includes(point)).join(", ")}.` : "Keep the answer grounded in the question and make the key evidence explicit.",
      rubric.filter((point) => !foundPoints.includes(point)),
    ],
    [
      "Communication", communicationScore,
      `${fillers.length} filler(s), ${repetitions.length} repeated phrase(s), ${hedges.length} hedges, and ${jargon.length} common unexplained acronyms detected. Opening cue ${weakOpening ? "may be hesitant" : "is direct"}; transcript punctuation is only a rough clarity signal.`,
      fillers.length || repetitions.length ? "Replace fillers with a brief pause, remove repeated words, and close with the result." : jargon.length ? "Expand specialist acronyms once and end with a concise outcome." : "Use a clear opening and close with the result in one concise sentence.",
      [...fillers.map((item) => `Filler: ${item.word}`), ...hedges.map((item) => `Hedge: ${item[0]}`), ...repetitions.map((item) => `Repeated: ${item[0]}`), ...jargon.map((item) => `Acronym: ${item[0]}`)],
    ],
    [
      "Time management", timeScore,
      `${firstWord === null ? "Time to first word unavailable." : `First recognized word at ${firstWord.toFixed(1)} seconds.`} Answer duration ${Math.round(seconds)} seconds.${input.timeLimitSeconds > 0 && limitRatio > 2 ? " More than twice the time limit." : ""}${unfinished ? " Transcript has no closing punctuation; this is only an unfinished-answer cue." : ""}`,
      seconds < 30 ? "Develop the answer with one concrete example and a clear outcome." : limitRatio > 1 && input.timeLimitSeconds > 0 ? "Prioritize the key point and finish within the time limit." : unfinished ? "Reserve time to state a complete takeaway; punctuation in captions is imperfect." : "Leave a few seconds to state the takeaway before time expires.",
      [seconds < 30 ? "Answer under 30 seconds" : input.timeLimitSeconds > 0 && limitRatio > 2 ? "Answer exceeded twice the limit" : unfinished ? "Transcript has no closing punctuation" : "Answer duration within a usable range"],
    ],
    [
      "Voice delivery", voiceScore,
      audio ? `Estimated speaking pace ${pace} WPM; ${audio.longPauseSeconds.toFixed(1)} seconds of low-energy pauses; audio level variation ${audio.levelVariation.toFixed(2)} and rough pitch variation ${audio.estimatedPitchVariation.toFixed(2)}.` : `Estimated speaking pace ${pace} WPM from transcript duration; audio feature analysis unavailable.`,
      audio?.longPauseSeconds ? "Pause briefly to breathe, then resume at an even pace and keep the microphone level consistent." : "Vary emphasis on key points and maintain a comfortable, steady pace.",
      [`Estimated pace ${pace} WPM`, ...(audio ? [`Audio level variation ${audio.levelVariation.toFixed(2)}`] : [])],
    ],
    [
      "Answer structure", framingScore,
      framing.missing.length ? `Detected ${framing.present.length} of 4 structure cues; missing: ${framing.missing.join(", ")}.` : "All four expected structure cues were detected by keyword heuristics.",
      framing.missing.length ? `Add a clear ${framing.missing[0]} section to make the reasoning easier to follow.` : "Keep the structure, and make each section explicit with a transition.",
      framing.missing,
    ],
    [
      "Nervousness signals", nervousnessScore,
      `Heuristic only: ${fillers.length} filler phrase(s), ${audio?.longPauseSeconds.toFixed(1) ?? "0.0"} seconds of detected low-energy pauses, ${pace} WPM.`,
      "Treat this signal as a reflection prompt, not a diagnosis; try a deliberate breath and a slower first sentence.",
      [`${fillers.length} filler phrase(s)`, ...(audio ? [`${audio.longPauseSeconds.toFixed(1)} seconds low-energy pause`] : [])],
    ],
  ];

  return parts.map(([category, score, detail, fix, notes]) => {
    let markers = evidence(
      category === "Time management" && firstWord !== null ? firstWord
        : category === "Communication" && firstFiller ? markerTime(firstFiller.index)
          : category === "Answer structure" ? Math.max(0, Math.round(seconds * 0.8))
            : Math.max(0, Math.round(seconds / 2)),
      category === "Communication" && firstFiller ? `Filler “${firstFiller.word}”`
        : category === "Voice delivery" && pauseMarkers.length ? `Pause about ${pauseMarkers[0].durationSeconds.toFixed(1)}s`
          : category === "Nervousness signals" && paceSpikes.length ? "Pace increase"
            : "Answer signal",
      detail,
    );
    if (category === "Communication" && fillers.length > 1) {
      markers = fillers.slice(0, 5).map((item) => ({
        seconds: markerTime(item.index),
        label: `Filler “${item.word}”`,
        detail,
      }));
    }
    if (category === "Voice delivery" && pauseMarkers.length) {
      markers = [
        ...markers,
        ...pauseMarkers.map((pause) => ({
          seconds: pause.seconds,
          label: `Pause about ${pause.durationSeconds.toFixed(1)}s`,
          detail,
        })),
      ];
    }
    if ((category === "Voice delivery" || category === "Nervousness signals") && paceSpikes.length) {
      markers = [
        ...markers,
        ...paceSpikes.slice(0, 5).map((spike) => ({
          seconds: Math.round(spike.seconds),
          label: `Pace spike · ${Math.round(spike.wordsPerMinute)} WPM`,
          detail,
        })),
      ];
    }
    return { category, score, level: level(score), evidence: markers, fix, notes };
  });
}

export function createAnswerRecord(
  input: ScoringInput & { questionId: string; startedAt: number; endedAt: number; video?: Blob },
): AnswerRecord {
  return {
    questionId: input.questionId,
    question: input.question.prompt,
    transcript: input.transcript,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    video: input.video,
    paceSamples: input.audio?.paceSamples ?? [],
    report: scoreAnswer(input),
  };
}

export function combineReports(reports: CategoryReport[][]): CategoryReport[] {
  const categories = reports.flat();
  const names = [...new Set(categories.map((item) => item.category))];
  return names.map((category) => {
    const items = categories.filter((item) => item.category === category);
    const score = Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length);
    return {
      ...items[0],
      score,
      level: level(score),
      evidence: items.flatMap((item) => item.evidence).slice(0, 5),
      notes: [...new Set(items.flatMap((item) => item.notes))].slice(0, 8),
    };
  });
}
