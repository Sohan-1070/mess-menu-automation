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

const daysMap = {
  sunday: 'Sunday', sun: 'Sunday',
  monday: 'Monday', mon: 'Monday',
  tuesday: 'Tuesday', tue: 'Tuesday',
  wednesday: 'Wednesday', wed: 'Wednesday',
  thursday: 'Thursday', thu: 'Thursday',
  friday: 'Friday', fri: 'Friday',
  saturday: 'Saturday', sat: 'Saturday'
};

const monthsList = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

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

    // Try Orientation B first: Meals across Columns (Breakfast, Lunch, Snacks, Dinner), Days down Rows
    // (This is the most common college format, including VIT-AP)
    const resultB = parseDaysAsRows(grid, filePath);
    if (resultB && countValidDays(resultB) >= 3) {
      console.log(`[Parser] Parsed menu from sheet "${sheetName}" using Days-as-Rows orientation.`);
      return resultB;
    }

    // Try Orientation A: Days across Columns, Meals down Rows
    const resultA = parseDaysAsColumns(grid);
    if (resultA && countValidDays(resultA) >= 3) {
      console.log(`[Parser] Parsed menu from sheet "${sheetName}" using Days-as-Columns orientation.`);
      return resultA;
    }
  }

  throw new Error('Could not identify mess schedule structure in the spreadsheet. Please ensure the file contains days (Monday - Sunday) and meals (Breakfast, Lunch, Snacks, Dinner).');
}

// Orientation A: Days in column headers (MONDAY | TUESDAY | WEDNESDAY ...), Meals down Rows
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
  const _servingTimes = {};
  let currentMealKey = null;

  for (let r = dayRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    
    // Look at first 4 columns of this row to detect meal type
    const rowHeader = row.slice(0, 4).map(c => String(c || '').toLowerCase().trim()).join(' ');

    if (rowHeader.includes('break') || rowHeader.includes('bfast') || rowHeader.includes('morning') || rowHeader.includes('tiffin')) {
      currentMealKey = 'breakfast';
    } else if (rowHeader.includes('lunch') || rowHeader.includes('afternoon')) {
      currentMealKey = 'lunch';
    } else if (rowHeader.includes('snack') || rowHeader.includes('tea') || rowHeader.includes('hi-tea') || rowHeader.includes('refreshment')) {
      currentMealKey = 'snacks';
    } else if (rowHeader.includes('dinner') || rowHeader.includes('night') || rowHeader.includes('supper')) {
      currentMealKey = 'dinner';
    }

    // Check if any of the header cells have a timing range
    if (currentMealKey) {
      for (let c = 0; c < Math.min(row.length, 4); c++) {
        const cellStr = String(row[c] || '').trim();
        if (/\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*[-–—to]+\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?/i.test(cellStr)) {
          _servingTimes[currentMealKey] = cellStr;
          break;
        }
      }
    }

    if (currentMealKey) {
      Object.keys(dayColMap).forEach(colIdx => {
        const day = dayColMap[colIdx];
        const cellVal = String(row[colIdx] || '').trim().replace(/\r\n/g, ', ').replace(/\n/g, ', ');
        if (cellVal && cellVal.length > 1 && cellVal !== 'null' && cellVal !== 'undefined' && cellVal !== '-' && cellVal !== '--') {
          weekly[day][currentMealKey] = weekly[day][currentMealKey] 
            ? `${weekly[day][currentMealKey]}, ${cellVal}`
            : cellVal;
        }
      });
    }
  }

  return {
    weekly,
    specialDates: {},
    _servingTimes
  };
}

// Orientation B: Meals across Columns (Breakfast, Lunch, Snacks, Dinner), Days down Rows
// Supports multi-row day blocks (e.g. VIT-AP layout where dishes span multiple rows under a single day)
function parseDaysAsRows(grid, filePath = '') {
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

  // Detect Month and Year from header/title rows or filename
  let detectedMonth = new Date().getMonth();
  let detectedYear = new Date().getFullYear();

  const searchStr = (grid.slice(0, 10).map(row => (row || []).join(' ')).join(' ') + ' ' + filePath).toLowerCase();
  for (let m = 0; m < monthsList.length; m++) {
    if (searchStr.includes(monthsList[m])) {
      detectedMonth = m;
      break;
    }
  }
  const yearMatch = searchStr.match(/202[4-9]/);
  if (yearMatch) {
    detectedYear = parseInt(yearMatch[0], 10);
  }

  function parseDay(str) {
    const m = String(str || '').toLowerCase().match(/\b(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/);
    return m ? daysMap[m[1]] : null;
  }

  function parseDates(str) {
    const res = [];
    const matches = String(str || '').match(/\b\d{1,2}\b/g);
    if (matches) {
      for (const x of matches) {
        const n = parseInt(x, 10);
        if (n >= 1 && n <= 31) res.push(n);
      }
    }
    return res;
  }

  const blocks = [];
  let currentBlock = null;

  for (let r = mealRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    
    // Check first 2 columns for a Day keyword
    let dayFound = null;
    let dayCellVal = '';
    for (let c = 0; c < Math.min(row.length, 2); c++) {
      const d = parseDay(row[c]);
      if (d) {
        dayFound = d;
        dayCellVal = row[c];
        break;
      }
    }

    if (dayFound) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = {
        day: dayFound,
        dates: parseDates(dayCellVal),
        meals: { breakfast: [], lunch: [], snacks: [], dinner: [] }
      };
    }

    if (currentBlock) {
      for (const [colIdx, mealKey] of Object.entries(mealColMap)) {
        const val = String(row[colIdx] || '').trim();
        if (val && val !== 'null' && val !== 'undefined' && val !== '-' && val !== '--') {
          // Check if row has serving times
          if (/\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*[-–—to]+\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?/i.test(val)) {
            currentBlock._servingTimes = currentBlock._servingTimes || {};
            currentBlock._servingTimes[mealKey] = val;
          } else {
            currentBlock.meals[mealKey].push(val);
          }
        }
      }
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  if (blocks.length === 0) return null;

  const weekly = initEmptyWeekly();
  const specialDates = {};
  const _servingTimes = {};
  const todayDateNum = new Date().getDate();

  blocks.forEach(b => {
    const bMeals = {
      breakfast: b.meals.breakfast.join(', '),
      lunch: b.meals.lunch.join(', '),
      snacks: b.meals.snacks.join(', '),
      dinner: b.meals.dinner.join(', ')
    };

    if (b._servingTimes) {
      Object.assign(_servingTimes, b._servingTimes);
    }

    // Map each date to specialDates
    b.dates.forEach(d => {
      const mm = String(detectedMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const iso = `${detectedYear}-${mm}-${dd}`;
      specialDates[iso] = bMeals;
    });

    // Populate weekly:
    // If block's dates include today, or if weekly[b.day] doesn't have dishes yet, set it!
    if (b.dates.includes(todayDateNum) || !weekly[b.day].lunch) {
      weekly[b.day] = bMeals;
    }
  });

  return {
    weekly,
    specialDates,
    _servingTimes
  };
}

function initEmptyWeekly() {
  const weekly = {};
  daysList.forEach(d => {
    weekly[d] = { breakfast: '', lunch: '', snacks: '', dinner: '' };
  });
  return weekly;
}

function countValidDays(weeklyOrResult) {
  if (!weeklyOrResult) return 0;
  const weekly = weeklyOrResult.weekly || weeklyOrResult;
  let count = 0;
  if (!weekly || typeof weekly !== 'object') return 0;
  Object.keys(weekly).forEach(d => {
    if (d.startsWith('_')) return;
    const dayMeals = weekly[d];
    if (dayMeals && (dayMeals.breakfast || dayMeals.lunch || dayMeals.snacks || dayMeals.dinner)) {
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
