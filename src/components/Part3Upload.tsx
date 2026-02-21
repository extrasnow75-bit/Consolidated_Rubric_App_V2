import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, CanvasConfig } from '../types';
import { pushRubricToCanvas } from '../services/canvasService';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export const Part3Upload: React.FC = () => {
  const { state, setCsvOutput, setCanvasConfig, setError, setIsLoading, addToHistory } = useSession();

  const [courseUrl, setCourseUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [manualCsv, setManualCsv] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const csvToUse = state.csvOutput || manualCsv;

  const handleUpload = async () => {
    if (!courseUrl.trim() || !accessToken.trim()) {
      setError('Please enter Canvas URL and access token');
      return;
    }

    if (!csvToUse.trim()) {
      setError('No CSV content to upload');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadStatus(null);

    try {
      const config: CanvasConfig = {
        courseHomeUrl: courseUrl,
        accessToken: accessToken,
      };

      const result = await pushRubricToCanvas(config, csvToUse);
      setUploadStatus(result);

      if (result.success) {
        setCanvasConfig(config);
        addToHistory({
          id: Date.now().toString(),
          timestamp: Date.now(),
          rubricName: 'Uploaded Rubric',
          totalPoints: parseInt(state.rubricMetadata?.totalPoints || '0') || 100,
          csvFileName: state.csvFileName || 'rubric.csv',
          canvasUploadStatus: 'success',
        });
      }
    } catch (err: any) {
      setUploadStatus({
        success: false,
        message: `Upload failed: ${err.message}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">
        <h2 className="text-2xl font-black text-gray-900 mb-2">Upload to Canvas</h2>
        <p className="text-gray-600 font-medium mb-8">
          Enter your Canvas credentials to upload the rubric
        </p>

        {/* CSV Display */}
        {state.csvOutput && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm font-bold text-blue-900">
              ✓ CSV file ready ({state.csvFileName || 'rubric.csv'})
            </p>
          </div>
        )}

        {!state.csvOutput && !manualCsv && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl">
            <p className="text-sm font-bold text-yellow-900">
              ⚠ No CSV available. You can paste CSV content below or go back to Part 2.
            </p>
          </div>
        )}

        {/* Canvas Configuration */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Canvas Course URL
            </label>
            <input
              type="text"
              value={courseUrl}
              onChange={(e) => setCourseUrl(e.target.value)}
              placeholder="https://canvas.yourschool.edu/courses/12345"
              className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Find this in your browser's address bar when viewing a Canvas course
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Canvas API Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste your Canvas API token here"
                className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              >
                {showToken ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Get this from Canvas: Account → Settings → Approved Integrations
            </p>
          </div>
        </div>

        {/* Manual CSV Input (if no CSV from Part 2) */}
        {!state.csvOutput && (
          <div className="mb-6">
            <button
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-sm font-bold text-blue-600 hover:underline"
            >
              {showManualInput ? '▼ Hide CSV Input' : '▶ Paste CSV Manually'}
            </button>
            {showManualInput && (
              <textarea
                value={manualCsv}
                onChange={(e) => setManualCsv(e.target.value)}
                placeholder="Paste your CSV content here..."
                className="w-full h-32 p-3 border rounded-xl mt-3 focus:ring-2 focus:ring-blue-500 outline-none text-xs font-mono"
              />
            )}
          </div>
        )}

        {/* Status Messages */}
        {state.error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-6">
            <p className="text-sm text-red-700 font-bold">{state.error}</p>
          </div>
        )}

        {uploadStatus && (
          <div
            className={`p-4 border rounded-2xl mb-6 ${
              uploadStatus.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p
              className={`text-sm font-bold ${
                uploadStatus.success ? 'text-green-900' : 'text-red-900'
              }`}
            >
              {uploadStatus.message}
            </p>
          </div>
        )}

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={isUploading || !csvToUse.trim() || !courseUrl.trim() || !accessToken.trim()}
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
        >
          {isUploading && <Loader2 className="w-5 h-5 animate-spin" />}
          {isUploading ? 'Uploading...' : 'Upload to Canvas'}
        </button>

        {/* Additional Actions */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            onClick={() => {
              setCourseUrl('');
              setAccessToken('');
              setManualCsv('');
              setUploadStatus(null);
            }}
            className="px-4 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm"
          >
            Clear Fields
          </button>
          <button
            onClick={() => window.open('https://canvas.instructure.com/doc/api/file.accessing_via_api.html', '_blank')}
            className="px-4 py-2 text-blue-600 rounded-xl font-bold hover:bg-blue-50 transition-all text-sm"
          >
            Canvas Docs
          </button>
        </div>
      </div>
    </div>
  );
};
