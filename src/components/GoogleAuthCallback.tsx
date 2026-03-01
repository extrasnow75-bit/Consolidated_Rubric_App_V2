import React, { useEffect, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';

type AuthStep = 'validating' | 'exchanging' | 'fetching_profile' | 'redirecting' | 'error';

const STEPS: { key: AuthStep; label: string }[] = [
  { key: 'validating', label: 'Validating authorization' },
  { key: 'exchanging', label: 'Exchanging credentials' },
  { key: 'fetching_profile', label: 'Fetching your profile' },
  { key: 'redirecting', label: 'Redirecting to dashboard' },
];

/**
 * GoogleAuthCallback Component
 * Handles the OAuth redirect from Google after user authorization
 * Shows stepped progress so users know login isn't stuck
 */
const GoogleAuthCallback: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const { completeGoogleAuth, setCurrentStep, setError } = useSession();
  const [currentAuthStep, setCurrentAuthStep] = useState<AuthStep>('validating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Step 1: Validate URL parameters
        setCurrentAuthStep('validating');
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');
        const errorDescription = params.get('error_description');

        // Handle error from Google
        if (error) {
          const message = errorDescription || error;
          setErrorMessage(`Google sign-in failed: ${message}`);
          setCurrentAuthStep('error');
          setTimeout(() => {
            setError(`Google sign-in failed: ${message}`);
            window.history.replaceState({}, document.title, '/');
            setCurrentStep(AppMode.DASHBOARD);
            onComplete?.();
          }, 2000);
          return;
        }

        // Validate we have code and state
        if (!code || !state) {
          setErrorMessage('Invalid callback: missing authorization code');
          setCurrentAuthStep('error');
          setTimeout(() => {
            setError('Invalid OAuth callback: missing code or state parameter');
            window.history.replaceState({}, document.title, '/');
            setCurrentStep(AppMode.DASHBOARD);
            onComplete?.();
          }, 2000);
          return;
        }

        // Step 2: Exchange code for tokens
        setCurrentAuthStep('exchanging');

        // Step 3 & 4 happen inside completeGoogleAuth
        // We set fetching_profile optimistically after a brief delay
        const profileTimer = setTimeout(() => {
          setCurrentAuthStep('fetching_profile');
        }, 1500);

        await completeGoogleAuth(code, state);
        clearTimeout(profileTimer);

        // Step 4: Redirect
        setCurrentAuthStep('redirecting');

        // Brief pause so user sees the final step
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Clean up the OAuth query params from the URL
        window.history.replaceState({}, document.title, '/');

        // Transition to dashboard — setCurrentStep updates context state,
        // onComplete() resets isOAuthCallback in App so this component unmounts
        setCurrentStep(AppMode.DASHBOARD);
        onComplete?.();
      } catch (err: any) {
        setErrorMessage(err.message || 'Authentication failed');
        setCurrentAuthStep('error');
        setTimeout(() => {
          setError(`Authentication failed: ${err.message}`);
          window.history.replaceState({}, document.title, '/');
          setCurrentStep(AppMode.DASHBOARD);
          onComplete?.();
        }, 3000);
      }
    };

    handleCallback();
  }, [completeGoogleAuth, setCurrentStep, setError]);

  const getStepIndex = () => {
    return STEPS.findIndex((s) => s.key === currentAuthStep);
  };

  const stepIndex = getStepIndex();
  const progressPercent = currentAuthStep === 'error' ? 0 : ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full mx-4">
        {currentAuthStep !== 'error' ? (
          <>
            {/* Spinner */}
            <div className="flex justify-center mb-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>

            {/* Title */}
            <h2 className="text-xl font-black text-gray-900 text-center mb-6">Signing you in...</h2>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {STEPS.map((step, index) => (
                <div key={step.key} className="flex items-center gap-3">
                  {/* Step indicator */}
                  {index < stepIndex ? (
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : index === stepIndex ? (
                    <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-200 flex-shrink-0"></div>
                  )}

                  {/* Step label */}
                  <span
                    className={`text-sm font-medium ${
                      index < stepIndex
                        ? 'text-green-700'
                        : index === stepIndex
                        ? 'text-blue-700 font-bold'
                        : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                    {index === stepIndex && '...'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Error State */}
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-black text-gray-900 text-center mb-2">Sign-in failed</h2>
            <p className="text-sm text-red-600 text-center mb-4">{errorMessage}</p>
            <p className="text-xs text-gray-500 text-center">Redirecting to dashboard...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default GoogleAuthCallback;
