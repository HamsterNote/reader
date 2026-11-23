import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor
} from 'expo-router/testing-library'
import { router } from 'expo-router'
import { StackActions } from 'expo-router/react-navigation'

import { createFileSystemStorage } from '../../app/src/native/storage'
import { ReaderDataStore } from '../../src/host/readerDataStore'

jest.mock('../../app/src/native/storage', () => ({
  createFileSystemStorage: jest.fn()
}))
jest.mock('../../app/src/native/documents', () => ({}))
jest.mock('../../app/src/native/webAssets', () => ({
  preparePackagedWebReader: async () => ({
    entryUrl: 'file:///index.html',
    baseUrl: 'file:///'
  }),
  stageReaderDocument: async () => ({
    entryUrl: 'file:///index.html',
    baseUrl: 'file:///'
  })
}))
jest.mock('../../app/src/components/NativePdfReader', () => ({
  NativePdfReader: () => null
}))
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('node:crypto').randomUUID()
}))

const mockMount = jest.fn()
const mockUnmount = jest.fn()
const mockClose = jest.fn()
jest.mock('../../app/src/components/ReaderWebView', () => {
  const React = jest.requireActual('react')
  const { Text } = jest.requireActual('react-native')
  const { useNavigation } = jest.requireActual('expo-router')
  return {
    ReaderWebView: React.forwardRef(({ record, store, sessionId }, ref) => {
      const navigation = useNavigation()
      React.useEffect(() => {
        mockMount(record.fileId, store, sessionId, navigation)
        return () => mockUnmount(sessionId)
      }, [record.fileId, store, sessionId, navigation])
      React.useImperativeHandle(ref, () => ({ close: mockClose }))
      return <Text testID='web-session'>{record.fileName}</Text>
    })
  }
})

const idA = 'f_' + 'a'.repeat(32)
const idB = 'f_' + 'b'.repeat(32)
let write
let sendUrl

beforeEach(async () => {
  jest.clearAllMocks()
  const values = new Map()
  write = jest.fn(async (key, value) => values.set(key, value))
  const storage = { read: async (key) => values.get(key) ?? null, write }
  const seed = new ReaderDataStore(storage)
  for (const [fileId, fileName] of [
    [idA, 'a.epub'],
    [idB, 'b.epub']
  ]) {
    await seed.upsert({
      fileId,
      fileName,
      format: 'epub',
      size: 1,
      modifiedAt: 1,
      importedAt: 1,
      cachedUri: 'reader-files/' + fileName,
      snapshot: { data: null, progress: null, revision: 0 }
    })
  }
  createFileSystemStorage.mockReturnValue(storage)
  jest
    .spyOn(jest.requireMock('expo-linking'), 'addEventListener')
    .mockImplementation((type, listener) => {
      if (type === 'url') sendUrl = (url) => listener({ url })
      return { remove() {} }
    })
})

it.each(['open', 'debug/open'])(
  'cold %s link leaves a single index',
  async (path) => {
    renderRouter('app/app', { initialUrl: '/' + path + '?fileId=' + idA })
    expect(await screen.findByTestId('web-session')).toHaveTextContent('a.epub')
    expect(screen).toHavePathname('/')
    expect(router.canGoBack()).toBe(false)
    expect(createFileSystemStorage).toHaveBeenCalledTimes(1)
  }
)

it('forwards the first fileId when an open link repeats the parameter', async () => {
  renderRouter('app/app', { initialUrl: `/open?fileId=${idA}&fileId=${idB}` })
  expect(await screen.findByTestId('web-session')).toHaveTextContent('a.epub')
})

async function linkDuringSave(path, layout = 'single') {
  renderRouter('app/app')
  fireEvent.press(await screen.findByText('a.epub'))
  expect(await screen.findByTestId('web-session')).toHaveTextContent('a.epub')
  const [, store, sessionId] = mockMount.mock.calls[0]
  let confirm
  const gate = new Promise((resolve) => {
    confirm = resolve
  })
  const persist = write.getMockImplementation()
  write.mockImplementationOnce(async (...args) => {
    await gate
    return persist(...args)
  })
  const snapshot = { data: null, progress: null, revision: 1 }
  const pending = store.saveSnapshot(idA, snapshot)
  mockClose.mockImplementation(async () => {
    await pending
    return { status: 'closed' }
  })
  await act(async () =>
    sendUrl(`hamsterreader://${path}?fileId=${idB}&layout=${layout}`)
  )
  await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1))
  expect(screen).toHavePathname('/')
  expect(router.canGoBack()).toBe(false)
  expect(mockMount).toHaveBeenCalledTimes(1)
  expect(mockUnmount).not.toHaveBeenCalled()
  expect(createFileSystemStorage).toHaveBeenCalledTimes(1)
  return async () => {
    await act(async () => {
      confirm()
      await pending
    })
    const paneCount = layout === 'split' ? 2 : 1
    await waitFor(() =>
      expect(screen.getAllByTestId('web-session')).toHaveLength(paneCount)
    )
    for (const pane of screen.getAllByTestId('web-session')) {
      expect(pane).toHaveTextContent('b.epub')
    }
    expect(mockMount).toHaveBeenCalledTimes(1 + paneCount)
    expect(mockMount.mock.calls[1][1]).toBe(store)
    expect(mockUnmount).toHaveBeenCalledWith(sessionId)
    expect((await store.get(idA)).snapshot).toEqual(snapshot)
  }
}

it('delivers a warm open to the current host and waits for its pending write', async () => {
  const confirm = await linkDuringSave('open')
  await confirm()
})

it('waits for the old save before opening a second pane from a warm link', async () => {
  const confirm = await linkDuringSave('open', 'split')
  await confirm()
})

it('keeps the original session mounted when a native stack POP arrives during save', async () => {
  const confirm = await linkDuringSave('debug/open')
  const navigation = mockMount.mock.calls[0][3]
  expect(() => navigation.dispatch(StackActions.pop(1))).toThrow(
    /'POP'.*was not handled by any navigator/
  )
  expect(screen.getByTestId('web-session')).toHaveTextContent('a.epub')
  expect(mockUnmount).not.toHaveBeenCalled()
  expect(createFileSystemStorage).toHaveBeenCalledTimes(1)
  await confirm()
})
