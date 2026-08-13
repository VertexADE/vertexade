import { generateObject, isAvailable, prepareBuiltInModel, sendMessage } from 'expo-ai-kit'
import { applyDictationDeterministically, applyDictationToDraft, scrubTranscript, scrubTranscriptDeterministically } from './mobile-transcript-scrubber'

const mockedIsAvailable = jest.mocked(isAvailable)
const mockedPrepareBuiltInModel = jest.mocked(prepareBuiltInModel)
const mockedSendMessage = jest.mocked(sendMessage)
const mockedGenerateObject = jest.mocked(generateObject)

describe('mobile transcript scrubber', () => {
  beforeEach(() => {
    mockedIsAvailable.mockResolvedValue(false)
    mockedPrepareBuiltInModel.mockResolvedValue(undefined)
    mockedSendMessage.mockResolvedValue({ text: '' })
    mockedGenerateObject.mockResolvedValue({ object: { text: '' }, text: '' })
  })

  test('removes fillers and immediate repetitions without a model', () => {
    expect(scrubTranscriptDeterministically('Um, please please update  src/app.ts.')).toBe('please update src/app.ts.')
  })

  test('cleans Dutch fillers and repetitions without a model', () => {
    expect(scrubTranscriptDeterministically('Eh, ik wil wil dat je de tests uitvoert.')).toBe('ik wil dat je de tests uitvoert.')
  })

  test('uses the built-in model for a conservative rewrite', async () => {
    mockedIsAvailable.mockResolvedValue(true)
    mockedSendMessage.mockResolvedValue({ text: 'Please update src/app.ts.' })

    await expect(scrubTranscript('Uhm please update src/app.ts.')).resolves.toBe('Please update src/app.ts.')
    expect(mockedPrepareBuiltInModel).toHaveBeenCalledTimes(1)
    expect(mockedSendMessage).toHaveBeenCalledWith(
      [{ role: 'user', content: 'please update src/app.ts.' }],
      expect.objectContaining({ systemPrompt: expect.stringContaining('Preserve the exact meaning') }),
    )
  })

  test('forces Dutch output when cleaning a Dutch transcript', async () => {
    mockedIsAvailable.mockResolvedValue(true)
    mockedSendMessage.mockResolvedValue({ text: 'Ik wil dat je de tests uitvoert.' })

    await expect(scrubTranscript('Euh, ik wil dat je de tests uitvoert.')).resolves.toBe('Ik wil dat je de tests uitvoert.')
    expect(mockedSendMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ systemPrompt: expect.stringContaining('MUST respond in Dutch') }),
    )
  })

  test('honors an explicit Parakeet language override', async () => {
    mockedIsAvailable.mockResolvedValue(true)
    mockedSendMessage.mockResolvedValue({ text: 'Veuillez exécuter les tests.' })

    await scrubTranscript('Please run the tests.', 'fr')

    expect(mockedSendMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ systemPrompt: expect.stringContaining('MUST respond in French') }),
    )
  })

  test('rejects a rewrite that drops protected technical text', async () => {
    mockedIsAvailable.mockResolvedValue(true)
    mockedSendMessage.mockResolvedValue({ text: 'Please update the application.' })

    await expect(scrubTranscript('Please update src/app.ts.')).resolves.toBe('Please update src/app.ts.')
  })

  test('falls back when the system model fails', async () => {
    mockedIsAvailable.mockRejectedValue(new Error('Model unavailable'))
    await expect(scrubTranscript('Uh, run run the test.')).resolves.toBe('run the test.')
  })

  test('applies explicit draft editing commands without a model', () => {
    expect(applyDictationDeterministically('Keep this. Remove this sentence.', 'Remove the previous sentence and say add tests.')).toBe('Keep this. add tests.')
    expect(applyDictationDeterministically('Use staging', 'replace staging with production')).toBe('Use production')
    expect(applyDictationDeterministically('Discard me', 'clear the previous text and write Start fresh')).toBe('Start fresh')
  })

  test('applies Dutch draft editing commands without a model', () => {
    expect(applyDictationDeterministically('Bewaar dit. Verwijder deze zin.', 'Verwijder de vorige zin en schrijf Voeg tests toe.')).toBe(
      'Bewaar dit. Voeg tests toe.',
    )
    expect(applyDictationDeterministically('Gebruik staging', 'Vervang staging door productie')).toBe('Gebruik productie')
  })

  test('uses the system model to interpret a contextual spoken edit', async () => {
    mockedIsAvailable.mockResolvedValue(true)
    mockedGenerateObject.mockResolvedValue({ object: { text: 'Keep the first sentence. Add tests.' }, text: '{"text":"Keep the first sentence. Add tests."}' })

    await expect(applyDictationToDraft('Keep the first sentence. Delete this.', 'Actually remove that last bit and add tests.')).resolves.toBe(
      'Keep the first sentence. Add tests.',
    )
    expect(mockedGenerateObject).toHaveBeenCalledWith(
      [{ role: 'user', content: JSON.stringify({ existingDraft: 'Keep the first sentence. Delete this.', newTranscript: 'Actually remove that last bit and add tests.' }) }],
      expect.objectContaining({ required: ['text'] }),
      expect.objectContaining({ systemPrompt: expect.stringContaining('editing commands'), maxRepairAttempts: 1 }),
    )
  })

  test('appends ambiguous dictation rather than destructively guessing', async () => {
    await expect(applyDictationToDraft('Existing text.', 'Discuss how to remove previous text safely.')).resolves.toBe(
      'Existing text. Discuss how to remove previous text safely.',
    )
  })
})
