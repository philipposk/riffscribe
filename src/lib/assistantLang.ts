/**
 * What language the assistant listens and speaks in.
 *
 * The widget resolves a language from `<html lang>` and then the browser's own
 * setting, which is wrong here often enough to matter: the page is in English
 * and a Greek player's browser may well be set to English too, while they want
 * to talk to it in Greek. So the choice is explicit and remembered.
 *
 * The tag reaches speech recognition, speech synthesis and — where a server
 * voice is configured — Whisper and ElevenLabs. Telling a recogniser the wrong
 * language does not degrade it, it returns nothing at all, which is why this is
 * worth getting right rather than guessing.
 */

export type AssistantLang = "auto" | "en" | "el";

const KEY = "riffscribe:assistant-lang";

export const LANG_OPTIONS: { value: AssistantLang; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "el", label: "Ελληνικά" },
];

export function loadLang(): AssistantLang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "el" || v === "auto") return v;
  } catch {
    /* private mode */
  }
  return "auto";
}

export function saveLang(v: AssistantLang): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode — the choice just will not persist */
  }
}

/** BCP-47 for the widget. `undefined` lets it work the language out itself. */
export function bcp47(v: AssistantLang): string | undefined {
  if (v === "el") return "el-GR";
  if (v === "en") return "en-GB";
  return undefined;
}

/**
 * The widget's own chrome, in Greek. Anything omitted stays English.
 * Keys match the SDK's DEFAULT_STRINGS.
 */
export const GREEK_STRINGS: Record<string, string> = {
  launcherOpen: "Άνοιγμα βοηθού",
  close: "Κλείσιμο",
  settings: "Ρυθμίσεις",
  exportChat: "Εξαγωγή συνομιλίας",
  historyToggle: "Ιστορικό",
  attach: "Επισύναψη αρχείου",
  removeAttachment: "Αφαίρεση συνημμένου",
  inputPlaceholder: "Ρωτήστε ή πείτε τι να κάνω…",
  inputLabel: "Μήνυμα προς τον βοηθό",
  send: "Αποστολή",
  mic: "Ομιλία",
  micStop: "Διακοπή ηχογράφησης",
  micUnavailable: "Το μικρόφωνο δεν είναι διαθέσιμο σε αυτό το πρόγραμμα περιήγησης",
  readAloud: "Ανάγνωση απαντήσεων",
  readAloudOn: "Ανάγνωση απαντήσεων (ενεργή)",
  readAloudOff: "Ανάγνωση απαντήσεων (ανενεργή)",
  thinking: "Σκέφτομαι…",
  confirm: "Επιβεβαίωση",
  cancel: "Ακύρωση",
  retry: "Ξανά",
  suggestionsLabel: "Δοκιμάστε",
  copied: "Αντιγράφηκε",
  copyFailed: "Η αντιγραφή απέτυχε",
  scanning: "Διαβάζω τη σελίδα…",
  scanReady: "Έτοιμο",
  voiceOff: "Η φωνή είναι απενεργοποιημένη",
  voiceNoSpeech: "Δεν άκουσα κάτι — δοκιμάστε ξανά",
  voiceNotAllowed: "Δεν δόθηκε άδεια για το μικρόφωνο",
  voiceNoMic: "Δεν βρέθηκε μικρόφωνο",
  voiceError: "Πρόβλημα με τη φωνή",
  voiceServerFallback: "Χρήση της φωνής του προγράμματος περιήγησης",
  voiceBrowserFallback: "Χρήση της φωνής του προγράμματος περιήγησης",

  // Settings → Data: export/import and where chats are kept.
  settingsTabData: "Δεδομένα",
  settingsDataHint: "Εξαγάγετε τις συνομιλίες σας σε αρχείο ή εισαγάγετε ένα αντίγραφο ασφαλείας.",
  settingsExportChats: "Εξαγωγή όλων των συνομιλιών (JSON)",
  settingsImportChats: "Εισαγωγή συνομιλιών…",
  settingsImportOk: "Η εισαγωγή ολοκληρώθηκε",
  settingsImportFailed: "Μη έγκυρο αρχείο αντιγράφου ασφαλείας",
  settingsHistory: "Ιστορικό συνομιλιών",
  historyModeAccount: "Αποθήκευση στον λογαριασμό μου",
  historyModeAccountHint:
    "Οι συνομιλίες σας φυλάσσονται στον λογαριασμό σας, ώστε να τις βρίσκετε σε κάθε συσκευή όπου συνδέεστε.",
  historyModeDevice: "Αποθήκευση σε αυτή τη συσκευή",
  historyModeDeviceHint:
    "Οι συνομιλίες σας μένουν μόνο σε αυτό το πρόγραμμα περιήγησης. Δεν αποθηκεύονται στον λογαριασμό σας.",
  historyModeOff: "Χωρίς αποθήκευση",
  historyModeOffHint: "Οι συνομιλίες χάνονται όταν ανανεώσετε ή κλείσετε τη σελίδα.",
  historyRetention: "Οι αποθηκευμένες συνομιλίες διαγράφονται μετά από {months} μήνες χωρίς δραστηριότητα.",
  historyAccountNoAdapter: "Η αποθήκευση στον λογαριασμό δεν είναι διαθέσιμη εδώ.",
  historyAccountSignedOut: "Συνδεθείτε για να αποθηκεύετε τις συνομιλίες στον λογαριασμό σας.",
  historyMovePrompt:
    "Συνομιλίες σας αποθηκευμένες σε αυτή τη συσκευή: {count}. Να μεταφερθούν και στον λογαριασμό σας;\n\nΤο OK τις μεταφέρει. Η Ακύρωση τις αφήνει μόνο σε αυτή τη συσκευή.",
  historyMoveOffer: "Συνομιλίες σας αποθηκευμένες μόνο σε αυτή τη συσκευή: {count}.",
  historyMoveButton: "Μεταφορά στον λογαριασμό μου",
  historyMoveDone: "Μεταφέρθηκαν στον λογαριασμό σας: {count}.",
  historyMoveFailed: "Κάποιες συνομιλίες δεν μεταφέρθηκαν και παραμένουν σε αυτή τη συσκευή.",
  historyMoveSignedOutOffer:
    "Συνομιλίες που έγιναν χωρίς σύνδεση σε αυτή τη συσκευή: {count}. Μπορεί να τις έκανε οποιοσδήποτε χρησιμοποιεί αυτό το πρόγραμμα περιήγησης, οπότε μεταφέρετέ τις μόνο αν είναι δικές σας.",
  historyMoveSignedOutToDeviceButton: "Προσθήκη στις συνομιλίες μου",
  historyMoveSignedOutToDeviceDone: "Προστέθηκαν στις συνομιλίες σας: {count}.",
  historyAccountKept: "Οι συνομιλίες που έχουν ήδη αποθηκευτεί στον λογαριασμό σας μένουν εκεί μέχρι να τις διαγράψετε.",
  historyDeleteAll: "Διαγραφή όλων των συνομιλιών μου",
  historyDeleteAllConfirm: "Να διαγραφούν όλες οι συνομιλίες σας σε αυτή τη συσκευή; Αυτό δεν αναιρείται.",
  historyDeleteAllConfirmAccount:
    "Να διαγραφούν όλες οι συνομιλίες σας, σε αυτή τη συσκευή και στον λογαριασμό σας; Αυτό δεν αναιρείται.",
  historyDeleteDone: "Όλες οι συνομιλίες σας διαγράφηκαν.",
  historyDeleteFailed: "Δεν ήταν δυνατή η διαγραφή των συνομιλιών στον λογαριασμό σας. Δοκιμάστε ξανά.",
  historyLoading: "Φόρτωση των αποθηκευμένων συνομιλιών…",
  historyLoadFailed: "Δεν ήταν δυνατή η φόρτωση των αποθηκευμένων συνομιλιών.",
  historySaveFailed: "Δεν ήταν δυνατή η αποθήκευση στον λογαριασμό σας. Θα ξαναδοκιμάσει.",
  historyRetry: "Δοκιμή ξανά",
  historyChatUnavailable: "Δεν ήταν δυνατό το άνοιγμα αυτής της συνομιλίας. Δοκιμάστε ξανά.",
};

/** Added to the persona so replies come back in the right language. */
export function languageInstruction(v: AssistantLang): string {
  if (v === "el") {
    return " Απαντάς πάντα στα ελληνικά, με απλά λόγια. Οι μουσικοί όροι μπορούν να μείνουν στα αγγλικά αν είναι πιο σαφείς.";
  }
  if (v === "en") return " Always reply in English.";
  return " Reply in whatever language the player writes or speaks to you in.";
}
