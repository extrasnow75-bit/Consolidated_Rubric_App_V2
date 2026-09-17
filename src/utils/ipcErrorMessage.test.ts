import { describe, it, expect } from 'vitest';
import { ipcErrorMessage } from './ipcErrorMessage';

describe('ipcErrorMessage', () => {
  it('unwraps the message a failed IPC handler actually threw', () => {
    // Verbatim from the deployment timeline, the day a .docx would not convert.
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'gemini:generateAllCsvsFromDoc': Error: Could not find file in options",
        ),
      ),
    ).toBe('Could not find file in options');
  });

  it('keeps a message that was already plain', () => {
    expect(ipcErrorMessage(new Error('No Canvas token is saved.'))).toBe('No Canvas token is saved.');
  });

  it('strips a stacked error prefix', () => {
    expect(ipcErrorMessage(new Error('Error: TypeError: fetch failed'))).toBe('fetch failed');
  });

  it('leaves the channel name out but the punctuation in', () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'canvas:pushRubric': Error: Canvas rejected the rubric: criterion 3 has no ratings.",
        ),
      ),
    ).toBe('Canvas rejected the rubric: criterion 3 has no ratings.');
  });

  it('does not eat a message whose own text mentions an error', () => {
    expect(ipcErrorMessage(new Error('The document contains an Error: heading'))).toBe(
      'The document contains an Error: heading',
    );
  });

  it('never returns an empty string when there was something to show', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'x': Error:"))).toBe(
      "Error invoking remote method 'x': Error:",
    );
  });

  it('handles the things that are not Errors at all', () => {
    expect(ipcErrorMessage('plain string')).toBe('plain string');
    expect(ipcErrorMessage({ message: 'object with a message' })).toBe('object with a message');
  });
});
