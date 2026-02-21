import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, GenerationSettings } from '../types';
import { generateRubricFromScreenshot } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Upload, Download, Loader2, Trash2, Image as ImageIcon } from 'lucide-react';

export const ScreenshotConverter: React.FC = () => {
  const { state, setCurrentStep, setRubric, setIsLoading, setError } = useSession();

  const [imageFile, setImageFile] = useState<{ data: string; mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [settings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleImageSelect(e.dataTransfer.files[0]);
    }
  };

  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target?.result as string;
        const base64Data = imageData.split(',')[1]; // Remove data:image/...;base64, prefix
        const mimeType = file.type;

        setImageFile({
          data: base64Data,
          mimeType,
        });

        setImagePreview(imageData);
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(`Failed to process image: ${err.message}`);
      setIsLoading(false);
    }
  };

  const handleProcessImage = async () => {
    if (!imageFile) {
      setError('Please select an image');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const rubric = await generateRubricFromScreenshot(imageFile, settings);
      setRubric(rubric);
    } catch (err: any) {
      setError(`Failed to process screenshot: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportToWord = async () => {
    if (!state.rubric) return;
    try {
      await exportToWord(state.rubric);
    } catch (err: any) {
      setError(`Failed to export: ${err.message}`);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setRubric(null);
    setError(null);
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">
        {!state.rubric ? (
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Screenshot to Word</h2>
            <p className="text-gray-600 font-medium mb-8">
              Convert a Canvas rubric screenshot into an editable Word document
            </p>

            {!imagePreview ? (
              <>
                {/* Image Upload Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative w-full p-8 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                    isDragging
                      ? 'bg-blue-50 border-blue-400'
                      : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <ImageIcon className="w-8 h-8 text-gray-400" />
                  <p className="text-sm font-bold text-gray-700">
                    Drop a screenshot here or click to browse
                  </p>
                  <p className="text-xs text-gray-500">
                    PNG, JPG, WebP supported
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handleImageSelect(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                    id="image-input"
                  />
                  <label htmlFor="image-input" className="absolute inset-0 cursor-pointer" />
                </div>
              </>
            ) : (
              <>
                {/* Image Preview */}
                <div className="mb-6">
                  <p className="text-sm font-bold text-gray-700 mb-2">Preview</p>
                  <div className="border rounded-2xl overflow-hidden">
                    <img
                      src={imagePreview}
                      alt="Screenshot preview"
                      className="w-full max-h-64 object-contain"
                    />
                  </div>
                </div>

                {/* Process Button */}
                <button
                  onClick={handleProcessImage}
                  disabled={isProcessing}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2 mb-3"
                >
                  {isProcessing && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isProcessing ? 'Processing...' : 'Convert to Rubric'}
                </button>

                {/* Change Image Button */}
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="w-full py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
                >
                  Choose Different Image
                </button>
              </>
            )}

            {/* Error Display */}
            {state.error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mt-6">
                <p className="text-sm text-red-700 font-bold">{state.error}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Display Rubric */}
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">
                {state.rubric.title}
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                {state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points
              </p>

              {/* Preview Table */}
              <div className="overflow-x-auto mb-6 border rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Criteria</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Exemplary</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Proficient</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Developing</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Unsatisfactory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.rubric.criteria.map((criterion, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 font-bold text-gray-900">{criterion.category}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.exemplary.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.proficient.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.developing.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.unsatisfactory.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <button
                onClick={handleExportToWord}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2 mb-3"
              >
                <Download className="w-5 h-5" />
                Export to Word
              </button>

              {/* Reset Button */}
              <button
                onClick={handleReset}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Convert Another
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
