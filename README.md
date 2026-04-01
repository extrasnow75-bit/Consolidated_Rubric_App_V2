# Canvas Rubric Creator - Consolidated App

A unified React + TypeScript + Vite application that provides a complete workflow for creating, converting, and uploading rubrics to Canvas LMS.

## Features

### 🎯 All-in-One Workflow
- **Part 1: Create Rubric** - Transform assignment descriptions into professional rubrics using AI
- **Part 2: Convert to CSV** - Convert Word/PDF/Google Docs files to Canvas-compatible CSV format
- **Part 3: Upload to Canvas** - Push rubrics directly to Canvas LMS
- **Screenshot Converter** - Convert Canvas rubric screenshots to editable Word/Google documents

### 🔄 Session Memory
- Data persists as you move between workflow steps
- "New Batch" option to start another without losing history
- "New Session" to clear everything and reset

### 💾 Persistent UI
-Handles single rubrics or large batches
- Google Drive Picker functionality
- Make edits to rubric content within the app
- Save draft rubrics and/or CSV files or just push rubrics to Canvas and disgard draft documents

## Prerequisites

- Node.js 16+ and npm
- Gemini API key (from https://ai.google.dev)
- Canvas API token (for upload functionality)

## Installation

1. Clone/download the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your environment variables in `.env.local`:
   ```
   VITE_GEMINI_API_KEY=your_api_key_here
   ```

## Running Locally

```bash
npm run dev
```

The app will start at `http://localhost:5173` (or another port if 5173 is busy).

## Building for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

## Usage Guide

### Part 1: Creating a Rubric
1. Paste or upload an assignment description
2. Set total points and point style preference
3. Click "Generate Rubric"
4. Review and export to Word, or continue to Part 2

### Part 2: Converting Word to CSV
1. Upload a Word or PDF file containing a rubric
2. Select which rubric to convert (if multiple found)
3. Click "Generate CSV"
4. Copy or download the CSV, or continue to Part 3

### Part 3: Uploading to Canvas
1. Enter your Canvas course URL and API token
2. Upload will use the CSV from Part 2, or paste one manually
3. Click "Upload to Canvas"
4. Check Canvas for your new rubric in the Rubrics section

### Screenshot to Word
1. Take a screenshot of a Canvas rubric
2. Upload the image
3. Click "Convert to Rubric"
4. Export the recognized rubric to Word

## Architecture

```
rubric-app-consolidated/
├── src/
│   ├── App.tsx              # Main router component
│   ├── index.tsx            # React entry point
│   ├── types.ts             # Unified TypeScript types
│   ├── contexts/
│   │   └── SessionContext.tsx  # Global state management
│   ├── components/
│   │   ├── Layout.tsx          # Persistent banner + ribbon
│   │   ├── Dashboard.tsx       # Main menu
│   │   ├── Part1Rubric.tsx     # Create from text
│   │   ├── Part2WordToCsv.tsx  # Word to CSV converter
│   │   ├── Part3Upload.tsx     # Canvas uploader
│   │   ├── ScreenshotConverter.tsx  # Screenshot to Word
│   │   └── [Reusable components]
│   └── services/
│       ├── geminiService.ts     # AI-powered rubric generation
│       ├── canvasService.ts     # Canvas API integration
│       └── wordExportService.ts # Word document export
├── vite.config.ts
├── tsconfig.json
├── package.json
└── index.html
```

## API Keys

### Gemini API
1. Go to https://ai.google.dev
2. Click "Get API Key"
3. Create a new project and generate an API key
4. Add it to `.env.local` as `VITE_GEMINI_API_KEY`

### Canvas API Token
1. Log in to Canvas
2. Go to Account → Settings
3. Scroll to "Approved Integrations"
4. Click "+ New Access Token"
5. Name it and optionally set an expiration
6. Copy the token and paste in Part 3

## Troubleshooting

### CORS Error on Canvas Upload
- Enable a CORS extension in your browser (Allow CORS)
- Add your Canvas URL to the extension's whitelist
- Refresh the app after enabling the extension

### No Rubric Found in File
- Ensure the Word/PDF has a proper table structure with criteria and ratings
- The table should have columns for performance levels and points

### Gemini API Quota Exceeded
- The app automatically retries with exponential backoff
- If it persists, check your Gemini API usage limits

## Support

For issues or feature requests, please check the original app documentation or open an issue in the project repository.

## License

This is a consolidated version of four separate rubric tools, merged for seamless workflow management.
