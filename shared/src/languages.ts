export const DEFAULT_LANGUAGES = [
  'Japanese', 'Spanish', 'French', 'German',
  'Korean', 'Mandarin', 'Italian', 'Portuguese',
];

export const ALL_LANGUAGES_BY_REGION: { region: string; languages: string[] }[] = [
  {
    region: 'Europe',
    languages: [
      'English', 'French', 'German', 'Spanish', 'Italian', 'Portuguese',
      'Dutch', 'Polish', 'Russian', 'Swedish', 'Norwegian',
      'Danish', 'Greek', 'Czech', 'Romanian', 'Hungarian',
      'Ukrainian', 'Finnish', 'Turkish',
    ],
  },
  {
    region: 'East Asia',
    languages: ['Mandarin', 'Japanese', 'Korean', 'Cantonese'],
  },
  {
    region: 'Southeast Asia',
    languages: ['Vietnamese', 'Thai', 'Indonesian', 'Malay', 'Tagalog', 'Burmese'],
  },
  {
    region: 'South Asia',
    languages: ['Hindi', 'Bengali', 'Urdu', 'Tamil', 'Telugu', 'Marathi', 'Punjabi', 'Gujarati', 'Nepali'],
  },
  {
    region: 'Middle East',
    languages: ['Arabic', 'Hebrew', 'Persian', 'Turkish'],
  },
  {
    region: 'Africa',
    languages: ['Swahili', 'Amharic', 'Hausa', 'Yoruba', 'Zulu', 'Afrikaans', 'Somali'],
  },
  {
    region: 'Americas',
    languages: ['Spanish', 'Portuguese', 'French', 'Haitian Creole', 'Quechua'],
  },
];
