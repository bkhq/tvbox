// Read-only access to the Java app's data (native module `Migrate`, Android only):
//
//   const prefs = await legacyReader?.readLegacyPrefs(); // default SharedPreferences, typed
//   const db = await legacyReader?.readLegacyDb();       // Room db "tv": Config, History, Keep rows
//
// The Java app shares the applicationId, so its files are this app's files. Nothing
// is written back; on iOS / tvOS legacyReader is null and getAbiFlavor() returns "".
export * from './src/Migrate';
export type * from './src/Migrate.types';
