const QUESTION_TEMPLATES = [
  (t) => `What is one ${t} you could happily choose again and again?`,
  (t) => `What is your earliest memory involving ${t}?`,
  (t) => `What makes ${t} instantly better for you?`,
  (t) => `What is a ${t} choice that says a lot about your personality?`,
  (t) => `What is an underrated ${t} that deserves more attention?`,
  (t) => `What is the most unexpectedly good ${t} experience you have had?`,
  (t) => `What is one ${t} you would love to experience with a friend?`,
  (t) => `Which ${t} are you most likely to recommend to someone?`,
  (t) => `What is your comfort pick when it comes to ${t}?`,
  (t) => `What is one ${t} you never get tired of talking about?`,
  (t) => `What is a ${t} opinion you changed your mind about?`,
  (t) => `What ${t} instantly makes a normal day feel better?`,
  (t) => `What is one ${t} you would keep if you could only keep one?`,
  (t) => `What is the funniest thing that happened because of ${t}?`,
  (t) => `What is a ${t} you wish you had discovered earlier?`,
  (t) => `What is your ideal version of ${t}?`,
  (t) => `What is a ${t} that you associate with a really good memory?`,
  (t) => `What is one ${t} that you think people misunderstand?`,
  (t) => `If money and time did not matter, what ${t} would you explore first?`,
  (t) => `What is a small detail about ${t} that matters more to you than people expect?`
];

const QUESTION_TOPICS = [
  ["comfort food", "Food"], ["songs", "Music"], ["music artists", "Music"], ["music genres", "Music"],
  ["movies", "Movies"], ["TV shows", "Movies"], ["video games", "Fun"], ["books", "Creative"],
  ["travel places", "Travel"], ["weekend activities", "Fun"], ["childhood games", "Childhood"], ["small habits", "Personality"],
  ["personal goals", "Goals"], ["skills", "Goals"], ["dream jobs", "Dreams"], ["things you collect", "Random"],
  ["ways to relax", "Life"], ["weather", "Random"], ["apps", "Technology"], ["school subjects", "Personality"],
  ["creative hobbies", "Creative"], ["celebrations", "Life"], ["little luxuries", "Favorites"], ["memories", "Childhood"],
  ["things that make you laugh", "Fun"], ["qualities in friends", "Relationships"]
];

export const QUESTION_BANK = QUESTION_TOPICS.flatMap(([topic, category], topicIndex) =>
  QUESTION_TEMPLATES.map((makeQuestion, templateIndex) => ({
    id: `q-${topicIndex + 1}-${templateIndex + 1}`,
    text: makeQuestion(topic),
    category,
    difficulty: templateIndex % 5 === 0 ? "deep" : templateIndex % 3 === 0 ? "medium" : "light"
  }))
);

export const QUESTION_CATEGORIES = [
  "Favorites", "Personality", "Deep", "Fun", "Relationships", "Random", "Dreams", "Life", "Childhood", "Goals", "Music", "Movies", "Food", "Travel", "Technology", "Creative"
];

export const CATEGORY_GROUPS = {
  mixed: QUESTION_BANK,
  light: QUESTION_BANK.filter(q => ["Food", "Music", "Movies", "Fun", "Favorites", "Random"].includes(q.category)),
  deep: QUESTION_BANK.filter(q => ["Deep", "Goals", "Dreams", "Relationships", "Life", "Personality", "Childhood"].includes(q.category) || q.difficulty === "deep"),
  random: QUESTION_BANK
};

export function getQuestionById(id, customQuestions = []) {
  return QUESTION_BANK.find(q => q.id === id) || customQuestions.find(q => q.id === id) || null;
}

export function shuffle(input) {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildQuestionSet(count, mode = "mixed", customQuestions = []) {
  const source = [...(CATEGORY_GROUPS[mode] || QUESTION_BANK), ...customQuestions];
  return shuffle(source).slice(0, Math.min(count, source.length));
}

export const QUESTION_BANK_COUNT = QUESTION_BANK.length;
