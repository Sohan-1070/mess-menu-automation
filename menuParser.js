const xlsx = require('xlsx');
const { extractTextFromPdf, parseMenuFromText } = require('./pdfParser');

const daysList = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const daysPrefixMap = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
};

function parseSpreadsheet(filePath) {
  const workbook = xlsx.readFile(filePath);
  
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Spreadsheet has no sheets!');
  }

  // Iterate over all sheets in the workbook to find the menu
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Convert sheet to a 2D raw array of cells
    const grid = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!grid || grid.length === 0) continue;

    // Try Orientation A: Days across Columns, Meals in Rows (Typical VIT / College layout)
    const resultA = parseDaysAsColumns(grid);
    if (resultA && countValidDays(resultA) >= 3) {
      console.log(`[Parser] Parsed menu from sheet "${sheetName}" using Days-as-Columns orientation.`);
      return resultA;
    }

    // Try Orientation B: Meals across Columns, Days in Rows (Standard Table layout)
    const resultB = parseDaysAsRows(grid);
    if (resultB && countValidDays(resultB) >= 3) {
      console.log(`[Parser] Parsed menu from sheet "${sheetName}" using Days-as-Rows orientation.`);
      return resultB;
    }
  }

  throw new Error('Could not identify mess schedule structure in the spreadsheet. Please ensure the file contains days (Monday - Sunday) and meals (Breakfast, Lunch, Snacks, Dinner).');
}

// Orientation A: Days in row headers (e.g. MONDAY | TUESDAY | WEDNESDAY ...), Meals as rows (BREAKFAST, LUNCH ...)
function parseDaysAsColumns(grid) {
  let dayRowIdx = -1;
  const dayColMap = {}; // { colIndex: 'Monday', ... }

  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] || [];
    let matchCount = 0;
    const tempMap = {};

    row.forEach((cell, c) => {
      const val = String(cell || '').trim().toLowerCase().replace(/[^a-z]/g, '');
      for (const [prefix, fullDay] of Object.entries(daysPrefixMap)) {
        if (val.startsWith(prefix) || val === prefix) {
          tempMap[c] = fullDay;
          matchCount++;
          break;
        }
      }
    });

    if (matchCount >= 3) {
      dayRowIdx = r;
      Object.assign(dayColMap, tempMap);
      break;
    }
  }

  if (dayRowIdx === -1) return null;

  const weekly = initEmptyWeekly();

  for (let r = 0; r < grid.length; r++) {
    if (r === dayRowIdx) continue;
    const row = grid[r] || [];
    
    // Look at the first few columns of this row to detect meal type
    const rowHeader = row.slice(0, 4).map(c => String(c || '').toLowerCase().trim()).join(' ');

    let mealKey = null;
    if (rowHeader.includes('break') || rowHeader.includes('bfast') || rowHeader.includes('morning') || rowHeader.includes('tiffin')) {
      mealKey = 'breakfast';
    } else if (rowHeader.includes('lunch') || rowHeader.includes('afternoon')) {
      mealKey = 'lunch';
    } else if (rowHeader.includes('snack') || rowHeader.includes('tea') || rowHeader.includes('hi-tea') || rowHeader.includes('refreshment')) {
      mealKey = 'snacks';
    } else if (rowHeader.includes('dinner') || rowHeader.includes('night') || rowHeader.includes('supper')) {
      mealKey = 'dinner';
    }

    if (mealKey) {
      Object.keys(dayColMap).forEach(colIdx => {
        const day = dayColMap[colIdx];
        const cellVal = String(row[colIdx] || '').trim().replace(/\r\n/g, ', ').replace(/\n/g, ', ');
        if (cellVal && cellVal.length > 1) {
          weekly[day][mealKey] = weekly[day][mealKey] 
            ? `${weekly[day][mealKey]}, ${cellVal}`
            : cellVal;
        }
      });
    }
  }

  return weekly;
}

// Orientation B: Meals in column headers (e.g. Breakfast | Lunch | Snacks | Dinner), Days in rows
function parseDaysAsRows(grid) {
  let mealRowIdx = -1;
  const mealColMap = {}; // { colIndex: 'breakfast'|'lunch'|'snacks'|'dinner' }

  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] || [];
    let matchCount = 0;
    const tempMap = {};

    row.forEach((cell, c) => {
      const val = String(cell || '').trim().toLowerCase();
      if (val.includes('break') || val.includes('bfast') || val.includes('morning') || val.includes('tiffin')) {
        tempMap[c] = 'breakfast';
        matchCount++;
      } else if (val.includes('lunch') || val.includes('afternoon')) {
        tempMap[c] = 'lunch';
        matchCount++;
      } else if (val.includes('snack') || val.includes('tea') || val.includes('hi-tea') || val.includes('refreshment')) {
        tempMap[c] = 'snacks';
        matchCount++;
      } else if (val.includes('dinner') || val.includes('night') || val.includes('supper')) {
        tempMap[c] = 'dinner';
        matchCount++;
      }
    });

    if (matchCount >= 2) {
      mealRowIdx = r;
      Object.assign(mealColMap, tempMap);
      break;
    }
  }

  if (mealRowIdx === -1) return null;

  const weekly = initEmptyWeekly();

  for (let r = mealRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    
    // Check first 3 columns for day name
    let matchedDay = null;
    for (let c = 0; c < Math.min(row.length, 3); c++) {
      const cellVal = String(row[c] || '').trim().toLowerCase();
      for (const [prefix, fullDay] of Object.entries(daysPrefixMap)) {
        if (cellVal.startsWith(prefix) || cellVal === prefix) {
          matchedDay = fullDay;
          break;
        }
      }
      if (matchedDay) break;
    }

    if (matchedDay) {
      Object.keys(mealColMap).forEach(colIdx => {
        const mealKey = mealColMap[colIdx];
        const cellVal = String(row[colIdx] || '').trim().replace(/\r\n/g, ', ').replace(/\n/g, ', ');
        if (cellVal && cellVal.length > 1) {
          weekly[matchedDay][mealKey] = cellVal;
        }
      });
    }
  }

  return weekly;
}

function initEmptyWeekly() {
  const weekly = {};
  daysList.forEach(d => {
    weekly[d] = { breakfast: '', lunch: '', snacks: '', dinner: '' };
  });
  return weekly;
}

function countValidDays(weekly) {
  let count = 0;
  Object.keys(weekly).forEach(d => {
    const dayMeals = weekly[d];
    if (dayMeals.breakfast || dayMeals.lunch || dayMeals.snacks || dayMeals.dinner) {
      count++;
    }
  });
  return count;
}

async function parseAnyMenuFile(filePath, originalFilename) {
  const ext = (originalFilename || filePath).substring((originalFilename || filePath).lastIndexOf('.')).toLowerCase();

  if (ext === '.pdf') {
    const extractedText = await extractTextFromPdf(filePath);
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Could not extract text from this PDF. Please ensure it is a digital text PDF (not a flat image or scanned photo).');
    }
    const parsed = parseMenuFromText(extractedText);
    if (!parsed || countValidDays(parsed) === 0) {
      throw new Error('Could not automatically identify meal tables in the PDF. Please ensure the PDF contains text headings or use an Excel file.');
    }
    return parsed;
  } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    return parseSpreadsheet(filePath);
  } else {
    throw new Error(`Unsupported file type: ${ext}. Please upload a .pdf, .xlsx, .xls, or .csv file.`);
  }
}

module.exports = {
  parseAnyMenuFile,
  countValidDays
};
