const fs = require('fs');

async function extractTextFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pdfModule = require('pdf-parse');

  if (pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: buffer });
    const textData = await parser.getText();
    return textData.text || '';
  } else if (typeof pdfModule === 'function') {
    const data = await pdfModule(buffer);
    return data.text || '';
  } else {
    throw new Error('Unsupported pdf-parse module format.');
  }
}

function parseMenuFromText(rawText) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const result = {};

  // Clean raw text
  const cleanText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strategy 1: Day Blocks with Meal labels
  // Find where each day occurs in the text
  const dayIndices = [];
  days.forEach(day => {
    const regex = new RegExp(`\\b${day}\\b`, 'gi');
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      dayIndices.push({
        day,
        index: match.index
      });
    }
  });

  // Sort by appearance in the document
  dayIndices.sort((a, b) => a.index - b.index);

  if (dayIndices.length > 0) {
    for (let i = 0; i < dayIndices.length; i++) {
      const current = dayIndices[i];
      const nextIndex = i + 1 < dayIndices.length ? dayIndices[i + 1].index : cleanText.length;
      const dayChunk = cleanText.substring(current.index, nextIndex);

      const mealPatterns = [
        { key: 'breakfast', regex: /(?:breakfast|b\.?fast|morning\s+meal|bf)[\s:\-–—]+/i },
        { key: 'lunch', regex: /(?:lunch|afternoon\s+meal)[\s:\-–—]+/i },
        { key: 'snacks', regex: /(?:snacks|tea|hi[\s\-]?tea|evening\s+refreshment|refreshments)[\s:\-–—]+/i },
        { key: 'dinner', regex: /(?:dinner|night\s+meal|supper)[\s:\-–—]+/i }
      ];

      const foundMeals = [];
      mealPatterns.forEach(pattern => {
        const m = pattern.regex.exec(dayChunk);
        if (m) {
          foundMeals.push({
            key: pattern.key,
            start: m.index + m[0].length,
            headerIndex: m.index
          });
        }
      });

      foundMeals.sort((a, b) => a.headerIndex - b.headerIndex);

      const dayMeals = {};
      for (let j = 0; j < foundMeals.length; j++) {
        const mCur = foundMeals[j];
        const mNext = j + 1 < foundMeals.length ? foundMeals[j + 1].headerIndex : dayChunk.length;
        let mealText = dayChunk.substring(mCur.start, mNext)
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && !/^day\b/i.test(line))
          .join(', ')
          .replace(/\s+/g, ' ')
          .trim();

        // Remove trailing commas, pipes, dashes
        mealText = mealText.replace(/[,;|\-–—]+$/, '').trim();

        if (mealText) {
          dayMeals[mCur.key] = mealText;
        }
      }

      if (Object.keys(dayMeals).length > 0) {
        result[current.day] = {
          breakfast: dayMeals.breakfast || '',
          lunch: dayMeals.lunch || '',
          snacks: dayMeals.snacks || '',
          dinner: dayMeals.dinner || ''
        };
      }
    }
  }

  // Strategy 2: Delimited Table / Rows (if Strategy 1 found less than 3 days)
  if (Object.keys(result).length < 3) {
    const lines = cleanText.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      days.forEach(day => {
        const dayRegex = new RegExp(`^${day}\\b`, 'i');
        if (dayRegex.test(trimmed)) {
          // Split by pipe, tab, or double+ space
          const cols = trimmed.split(/[|\t]+|\s{3,}/).map(c => c.trim()).filter(Boolean);
          if (cols.length >= 4) {
            result[day] = {
              breakfast: cols[1] || '',
              lunch: cols[2] || '',
              snacks: cols[3] || '',
              dinner: cols[4] || cols[3] || ''
            };
          }
        }
      });
    });
  }

  return result;
}

module.exports = {
  extractTextFromPdf,
  parseMenuFromText
};
