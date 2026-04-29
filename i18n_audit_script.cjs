const fs = require('fs');
const path = require('path');
const glob = require('glob');

function flatten(obj, prefix = '') {
    let result = {};
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(result, flatten(obj[key], fullKey));
        } else {
            result[fullKey] = obj[key];
        }
    }
    return result;
}

const enLocales = flatten(JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8')));
const deLocales = flatten(JSON.parse(fs.readFileSync('src/i18n/locales/de.json', 'utf8')));

const files = glob.sync('src/**/*.{ts,tsx}');

const missingEn = new Set();
const missingDe = new Set();
const hardcodedStrings = [];

const tRegex = /(?:^|\W)i18n\.t\(\s*['"](.+?)['"]|(?:\W|^)t\(\s*['"](.+?)['"]/g;
// Simplified regex for text nodes and attributes
const jsxTextRegex = />([^<>{}\s][^<>{}]*[^<>{}\s])</g;
const attrRegex = /(?:placeholder|title|aria-label|alt)=["']([^"']+)["']/g;
const dialogRegex = /(?:alert|confirm|prompt|toast\.(?:success|error|loading))\(['"]([^'"]+)['"]/g;

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    // Scans for t('key')
    let match;
    while ((match = tRegex.exec(content)) !== null) {
        const key = match[1] || match[2];
        if (!enLocales[key]) missingEn.add(key);
        if (!deLocales[key]) missingDe.add(key);
    }

    lines.forEach((line, index) => {
        const lineNum = index + 1;
        if (line.includes('console.') || line.includes('import') || line.includes('className=')) return;

        // JSX Text
        let m;
        while ((m = jsxTextRegex.exec(line)) !== null) {
            const text = m[1].trim();
            if (text && !text.match(/^#[0-9a-fA-F]{3,6}$/) && !text.match(/^\//) && text.length > 2) {
                hardcodedStrings.push({ file, line: lineNum, text, type: 'JSX Text' });
            }
        }
        // Attributes
        while ((m = attrRegex.exec(line)) !== null) {
            const text = m[1].trim();
            if (text && text.length > 1) {
                hardcodedStrings.push({ file, line: lineNum, text, type: 'Attribute' });
            }
        }
        // Dialogs/Toasts
        while ((m = dialogRegex.exec(line)) !== null) {
            const text = m[1].trim();
            hardcodedStrings.push({ file, line: lineNum, text, type: 'Dialog/Toast' });
        }
    });
});

const result = {
    missingKeys: {
        en: Array.from(missingEn),
        de: Array.from(missingDe)
    },
    hardcodedStrings: hardcodedStrings
};

fs.writeFileSync('i18n-audit.json', JSON.stringify(result, null, 2));

console.log('--- i18n Audit Summary ---');
console.log(`Missing en keys: ${result.missingKeys.en.length}`);
console.log(`Missing de keys: ${result.missingKeys.de.length}`);
console.log(`Hardcoded strings: ${result.hardcodedStrings.length}`);
console.log('\nTop 30 Findings (Hardcoded):');
result.hardcodedStrings.slice(0, 30).forEach(s => {
    console.log(`[${s.type}] ${s.file}:${s.line} - "${s.text}"`);
});
console.log('\nAudit results saved to i18n-audit.json');
