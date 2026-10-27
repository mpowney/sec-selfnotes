#!/usr/bin/osascript -l JavaScript
// Exports Apple Notes (including iCloud accounts) to <outDir>/<account>/<folder>/<note>.html on macOS.
// Usage:  osascript -l JavaScript tools/icloud-export.js ~/NotesExport
// Run periodically (cron/launchd) and point the sync UI's "Folder" watcher at <outDir>.
// Unchanged notes are skipped. Inline images are exported as data: URIs by Notes and are imported as
// encrypted attachments. Password-locked notes are skipped (their body is not scriptable).
ObjC.import('Foundation');

function safe(s) { return String(s).replace(/[^\w.\- ]+/g, '_').trim().slice(0, 80) || 'untitled'; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function run(argv) {
  if (!argv.length) throw new Error('Usage: icloud-export.js <outDir>');
  const out = $(argv[0]).stringByStandardizingPath.js;
  const fm = $.NSFileManager.defaultManager;
  const Notes = Application('Notes');
  let written = 0, skipped = 0;
  Notes.accounts().forEach((acct) => {
    acct.folders().forEach((folder) => {
      const dir = [out, safe(acct.name()), safe(folder.name())].join('/');
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(dir), true, $(), $());
      folder.notes().forEach((note) => {
        try {
          if (note.passwordProtected()) { skipped++; return; }
          const mod = note.modificationDate();
          const id = String(note.id()).split('/').pop();
          const path = dir + '/' + safe(note.name()) + '-' + safe(id) + '.html';
          const attrs = fm.attributesOfItemAtPathError($(path), $());
          if (attrs && !attrs.isNil() && attrs.fileModificationDate.js.getTime() >= mod.getTime()) { skipped++; return; }
          const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(note.name()) +
            '</title></head><body>' + note.body() + '</body></html>';
          $(html).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, $());
          fm.setAttributesOfItemAtPathError($({ NSFileModificationDate: $(mod) }), $(path), $());
          written++;
        } catch (e) { skipped++; }
      });
    });
  });
  return 'Exported ' + written + ' notes, skipped ' + skipped;
}
