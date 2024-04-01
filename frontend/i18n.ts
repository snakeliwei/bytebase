import { config } from "dotenv";
import { promises as fs } from "fs";

// Create a file .env.i18n and add
// GOOGLE_TRANSLATE_API_KEY=xxxx
config({ path: "./.env.i18n" });

// Replace 'YOUR_API_KEY' with your actual Google Cloud API key
const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

type JsonValue =
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonArray = Array<JsonValue>;

const SOURCE_LANG = "en-US";

const TARGET_LANGS = ["es-ES", "ja-JP", "vi-VN", "zh-CN"];

// Function to translate text using Google Cloud Translation API
async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = "en"
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      source: sourceLang,
      format: "text",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Google Cloud Translation API Error: ${data.error?.message || "Unknown error"}\nPlease create .env.i18n locally and set GOOGLE_TRANSLATE_API_KEY=xxx.`
    );
  }

  return data.data.translations[0].translatedText;
}

// Function specifically for JsonObject translation
async function translateJsonObject(
  obj: JsonObject,
  targetLang: string
): Promise<JsonObject> {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(obj)) {
    result[key] = await translateJsonValue(value, targetLang);
  }

  return result;
}

// Function to process and translate any JsonValue
async function translateJsonValue(
  value: JsonValue,
  targetLang: string
): Promise<JsonValue> {
  if (typeof value === "string") {
    // Translate string values
    return await translateText(value, targetLang);
  } else if (Array.isArray(value)) {
    // Recursively handle arrays
    const result: JsonArray = [];
    for (const item of value) {
      result.push(await translateJsonValue(item, targetLang));
    }
    return result;
  } else if (typeof value === "object" && value !== null) {
    // Recursively handle objects
    return await translateJsonObject(value, targetLang);
  } else {
    // Return other types (numbers, booleans, etc.) directly
    return value;
  }
}

async function loadJsonFile(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

async function saveJsonFile(filePath: string, data: any): Promise<void> {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
    console.log(`Updated ${filePath}`);
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
  }
}

async function addMissingKeysFromSource(
  source: JsonObject,
  target: JsonObject,
  lang: string
): Promise<JsonObject> {
  const merged: JsonObject = {};
  const keys = new Set([...Object.keys(source), ...Object.keys(target)]);

  for (const key of keys) {
    if (key in source && !(key in target)) {
      // Key exists in source but not in target
      merged[key] = await translateJsonValue(source[key], lang);
    } else if (
      key in source &&
      key in target &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      // Both have the key and its value is an object, merge recursively
      merged[key] = await addMissingKeysFromSource(
        source[key] as JsonObject,
        target[key] as JsonObject,
        lang
      );
    } else {
      // Key exists in target or both, prefer target's value
      merged[key] = target[key];
    }
  }

  return merged;
}

// Main function to load the source file and update each target file
async function updateLocalizationFiles() {
  const sourceData = await loadJsonFile(`src/locales/${SOURCE_LANG}.json`);
  const sourceSQLReviewData = await loadJsonFile(
    `src/locales/sql-review/${SOURCE_LANG}.json`
  );

  for (const lang of TARGET_LANGS) {
    const langFile = `src/locales/${lang}.json`;
    const targetData = await loadJsonFile(langFile);
    const updatedData = await addMissingKeysFromSource(
      sourceData,
      targetData,
      lang.split("-")[0]
    );
    await saveJsonFile(langFile, updatedData);

    const langSQLReviewFile = `src/locales/sql-review/${lang}.json`;
    const targetSQLReviewData = await loadJsonFile(langSQLReviewFile);
    const updatedSQLReviewData = await addMissingKeysFromSource(
      sourceSQLReviewData,
      targetSQLReviewData,
      lang.split("-")[0]
    );
    await saveJsonFile(langSQLReviewFile, updatedSQLReviewData);
  }
}

updateLocalizationFiles().catch(console.error);
