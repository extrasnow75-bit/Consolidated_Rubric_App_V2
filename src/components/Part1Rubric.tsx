import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, GenerationSettings } from '../types';
import { generateRubricFromDescription } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Loader2, Download, Trash2, Settings, FileText } from 'lucide-react';

export const Part1Rubric: React.FC = () => {
  const { state, setCurrentStep, setRubric, setIsLoading, setError } = useSession();

  const [assignmentDescription, setAssignmentDescription] = useState<string>('');
  const [settings, setSettings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const cancelRef = useRef<boolean>(false);

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const text = await file.text();
      setAssignmentDescription(text);
    } catch (err) {
      setError(`Failed to read file: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleGenerateRubric = async () => {
    if (!assignmentDescription.trim()) {
      setError('Please enter an assignment description');
      return;
    }

    setIsGenerating(true);
    setError(null);
    cancelRef.current = false;

    try {
      const rubric = await generateRubricFromDescription(
        assignmentDescription,
        settings
      );

      if (!cancelRef.current) {
        setRubric(rubric);
        setError(null);
      }
    } catch (err: any) {
      setError(`Failed to generate rubric: ${err.message}`);
    } finally {
      setIsGenerating(false);
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

  const handleContinue = () => {
    if (!state.rubric) {
      setError('Please generate a rubric first');
      return;
    }
    setCurrentStep(AppMode.PART_2);
  };

  const handleReset = () => {
    setAssignmentDescription('');
    setRubric(null);
    setError(null);
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">
        {!state.rubric ? (
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Create Draft Rubric</h2>
            <p className="text-gray-600 font-medium mb-8">
              Paste or upload an assignment description to create a draft rubric
            </p>

            {/* File Upload Area */}
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
              <FileText className="w-8 h-8 text-gray-400" />
              <p className="text-sm font-bold text-gray-700">
                Drop a text file here or click to browse
              </p>
              <input
                type="file"
                accept=".txt,.doc,.docx"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="hidden"
                id="file-input"
              />
              <label htmlFor="file-input" className="absolute inset-0 cursor-pointer" />
            </div>

            {/* Text Area */}
            <textarea
              value={assignmentDescription}
              onChange={(e) => setAssignmentDescription(e.target.value)}
              placeholder="Or paste your assignment description here..."
              className="w-full h-48 p-4 border rounded-2xl mt-6 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />

            {/* Settings */}
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">
                  Total Points
                </label>
                <input
                  type="number"
                  value={settings.totalPoints}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      totalPoints: parseInt(e.target.value) || 100,
                    })
                  }
                  className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">
                  Point Style
                </label>
                <select
                  value={settings.pointStyle}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      pointStyle: e.target.value as PointStyle,
                    })
                  }
                  className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value={PointStyle.RANGE}>Ranges</option>
                  <option value={PointStyle.SINGLE}>Single Values</option>
                </select>
              </div>
            </div>

            {/* Error Display */}
            {state.error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mt-6">
                <p className="text-sm text-red-700 font-bold">{state.error}</p>
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerateRubric}
              disabled={isGenerating || !assignmentDescription.trim()}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
            >
              {isGenerating && <Loader2 className="w-5 h-5 animate-spin" />}
              {isGenerating ? 'Generating Rubric...' : 'Generate Rubric'}
            </button>
          </>
        ) : (
          <>
            {/* Display Generated Rubric */}
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
              <div className="flex gap-4">
                <button
                  onClick={handleExportToWord}
                  className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Export to Word
                </button>
                <button
                  onClick={handleContinue}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
                >
                  Continue to Part 2
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
