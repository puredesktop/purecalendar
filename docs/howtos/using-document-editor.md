# Using The Document Editor

Use the platform document editor when the app needs a rich writing surface:
notes, long-form documents, reports, books, review workflows, markdown-backed
content, or any product surface where formatting matters.

The editor is controlled by the app. The platform provides the TipTap editor,
toolbar, comments, slash commands, document features, and conversion helpers.
The bridge provides the shell persistence mechanisms. Your app owns the typed
editor surface or session code that decides what to load, when to save, which
bridge helper to call, and how persisted data maps back into product state.

The editor does not persist content by itself.

## Imports

Generated apps import the editor from the UI bridge package:

```tsx
import {
  DocumentEditor,
  type DocumentEditorHandle,
  type EditorViewMode,
  EditorViewModeToggle,
  DocumentToolbarIcon,
  ToolbarActionButton,
  ToolbarActionDivider,
  ToolbarActionStrip,
  ToolbarInlineToolButton,
  useEditorExtensions,
  type SlashCommandItem,
} from '@purescience/platform-ui/editor'
```

## Minimal Editor

```tsx
import { useMemo, useRef, useState } from 'react'
import {
  DocumentEditor,
  type DocumentEditorHandle,
  type SlashCommandItem,
  useEditorExtensions,
} from '@purescience/platform-ui/editor'

export function NotesEditor(): React.ReactElement {
  const editorRef = useRef<DocumentEditorHandle>(null)
  const [content, setContent] = useState('<h1>Untitled</h1><p></p>')
  const extensions = useEditorExtensions({
    placeholder: 'Start writing...',
    features: {
      comments: true,
      autoReviewPrompts: true,
      tables: true,
      taskList: true,
      math: true,
      mermaid: true,
    },
  })

  const slashCommands = useMemo<SlashCommandItem[]>(
    () => [
      {
        id: 'insert-summary',
        title: 'Summary block',
        description: 'Add a heading and starter paragraph.',
        section: 'App',
        run: ({ editor, range }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent('<h2>Summary</h2><p></p>')
            .run()
        },
      },
    ],
    [],
  )

  return (
    <DocumentEditor
      ref={editorRef}
      value={content}
      extensions={extensions}
      inputFormat="html"
      outputFormat="html"
      enableComments
      slashCommands={slashCommands}
      onChange={setContent}
    />
  )
}
```

`onChange` receives the serialized document in the selected output format. Save
that value through the app's existing document/page/session save path. Simple
apps can debounce and call their session update command from the editor surface.
Larger document apps can delegate to their document/session modules. Do not make
the editor own product persistence.

## Capability Map

The editor package includes these capability groups:

| Capability | Exports | Use when |
| --- | --- | --- |
| Document surface | `DocumentEditor`, `DocumentEditorHandle`, `DocumentEditorProps` | Rendering and controlling a rich document editor. |
| Extension setup | `useEditorExtensions`, `buildExtensions`, `EditorFeatures` | Choosing document features for the product surface. |
| Content conversion | `resolveEditorContent`, `toHtml`, `toMd`, `EditorInputFormat` | Loading markdown or HTML and saving in the app's chosen format. |
| Toolbar chrome | `DocumentToolbarIcon`, `ToolbarActionStrip`, `ToolbarActionButton`, `ToolbarActionIconButton`, `ToolbarInlineToolButton`, `ToolbarActionDivider` | Adding app controls into the shared editor toolbar. |
| View mode | `EditorViewModeToggle`, `EditorViewMode` | Switching between full editor chrome and a quiet page view. |
| Slash commands | `SlashCommands`, `createDefaultSlashCommands`, `SlashCommandItem` | Adding app-specific insert/actions to the slash menu. |
| Comments and review marks | `CommentMark`, comment types/status helpers, `parseCommentReplies`, `serializeCommentReplies` | Anchored review comments and editorial annotations. |
| Auto review | `runAutoReview`, `buildAutoReviewPrompt`, `buildAutoReviewPromptBundle`, `collectAutoReviewParagraphs`, `collectScopedAutoReviewParagraphs`, `validateAutoReviewFindings` | App-provided review workflows that annotate document text. |
| Rich document nodes | `Figure`, `Footnote`, `IndexMarker`, `MermaidBlock`, `SmartTypography`, math insertion helpers | Product surfaces that need figures, notes, diagrams, smart typography, or editable math. |
| Assets | `CollectionImage`, `createCollectionImagePasteExtension`, `insertCollectionImage`, `insertCollectionImageFromBinaryResult` | Persisted pasted or selected images that need app-managed storage. |
| Diff view | `DocumentDiffView`, `buildAlignedLineDiff` | Showing text/document differences in app UI. |

## Feature Flags

`useEditorExtensions` builds the shared extension set. Enable only the features
the product needs:

```tsx
const extensions = useEditorExtensions({
  placeholder: 'Write the report...',
  features: {
    tables: true,
    taskList: true,
    highlight: true,
    math: true,
    figures: true,
    mermaid: true,
    footnotes: true,
    smartTypography: true,
    comments: true,
    autoReviewPrompts: true,
    indexMarkers: false,
    documentAssetIdentity: true,
  },
})
```

Comments require both `features.comments` and `enableComments` on
`DocumentEditor`.

## Editor Handle

Use a ref for explicit editor actions:

```tsx
const editorRef = useRef<DocumentEditorHandle>(null)

editorRef.current?.insertHtml('<p>Inserted from the app.</p>')
editorRef.current?.insertImage({
  src: imageUrl,
  alt: 'Sketch',
  caption: 'Draft sketch',
})

const tiptapEditor = editorRef.current?.getEditor()
```

The handle also supports opening, updating, applying, removing, and clearing
comment marks, plus `runAutoReview` when the app provides a review provider.

## View Modes

Use `boxed` for a full editing surface with toolbar chrome. Use `page` for a
quiet reading or print-like surface.

```tsx
const [viewMode, setViewMode] = useState<EditorViewMode>('boxed')

return (
  <>
    <EditorViewModeToggle value={viewMode} onChange={setViewMode} />
    <DocumentEditor
      value={content}
      extensions={extensions}
      viewMode={viewMode}
      showToolbar={viewMode !== 'page'}
      showSelectionComments={viewMode !== 'page'}
      onChange={setContent}
    />
  </>
)
```

## Toolbar Slots

Keep product-specific controls outside the editor implementation by using the
toolbar slots:

```tsx
<DocumentEditor
  value={content}
  extensions={extensions}
  toolbarInlineTools={
    <ToolbarActionStrip>
      <ToolbarInlineToolButton
        aria-label="Insert section"
        title="Insert section"
        onClick={() => editorRef.current?.insertHtml('<h2>New section</h2>')}
      >
        <DocumentToolbarIcon name="insert-menu" />
      </ToolbarInlineToolButton>
    </ToolbarActionStrip>
  }
  toolbarActions={
    <ToolbarActionStrip>
      <ToolbarActionDivider />
      <ToolbarActionButton onClick={saveDocument}>
        Save
      </ToolbarActionButton>
    </ToolbarActionStrip>
  }
  onChange={setContent}
/>
```

Use platform toolbar components for editor chrome, and keep app-specific logic
in app hooks or `src/lib`.

## Assets

There are two image paths.

Use `editorRef.current?.insertImage(...)` only when the app already has a stable
image URL:

```tsx
editorRef.current?.insertImage({
  src: imageUrl,
  alt: 'Screenshot',
  caption: 'Imported screenshot',
})
```

Use collection image handling when the user can paste, drop, or choose image
files and the app must keep those files with the document. In that flow:

1. The editor detects pasted/dropped image bytes.
2. The app writes those bytes through bridge filesystem helpers.
3. The app inserts an image node into the editor.
4. The document stores a relative asset path so it can be reopened later.

Wire it like this:

```tsx
import { useMemo, useRef } from 'react'
import {
  CollectionImage,
  createCollectionImagePasteExtension,
  DocumentEditor,
  type DocumentEditorHandle,
  useEditorExtensions,
} from '@purescience/platform-ui/editor'
import { createCollectionImagePasteHandler } from '@purescience/platform-ui/bridge/collectionImagePaste'
import { DEFAULT_COLLECTION_FIGURES_DIR } from '@purescience/platform-ui/bridge/collectionAssets'
import {
  readPlatformFileBinary,
  writePlatformFileBinary,
} from '../bridge/platformBridge'

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

async function readImageBytes(absolutePath: string): Promise<Uint8Array> {
  const result = await readPlatformFileBinary(absolutePath)
  return base64ToBytes(result.base64)
}

async function writeImageBytes(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writePlatformFileBinary(absolutePath, bytesToBase64(bytes))
}

export function DocumentWithImages({
  documentFolder,
  content,
  onChange,
}: {
  documentFolder: string
  content: string
  onChange: (content: string) => void
}): React.ReactElement {
  const editorRef = useRef<DocumentEditorHandle>(null)
  const baseExtensions = useEditorExtensions({
    placeholder: 'Start writing...',
    features: {
      figures: true,
    },
  })

  const handlePastedImage = useMemo(
    () =>
      createCollectionImagePasteHandler({
        collectionPath: documentFolder,
        subdir: DEFAULT_COLLECTION_FIGURES_DIR,
        getEditor: () => editorRef.current?.getEditor(),
        writeBinary: writeImageBytes,
      }),
    [documentFolder],
  )

  const extensions = useMemo(() => {
    const withoutStockImage = baseExtensions.filter(
      extension => extension.name !== 'image',
    )
    return [
      ...withoutStockImage,
      CollectionImage,
      createCollectionImagePasteExtension({
        handleImage: handlePastedImage,
        readBinary: readImageBytes,
      }),
    ]
  }, [baseExtensions, handlePastedImage])

  return (
    <DocumentEditor
      ref={editorRef}
      value={content}
      extensions={extensions}
      onChange={onChange}
    />
  )
}
```

`CollectionImage` replaces the stock image node because collection images need
two things at once: a data URL for immediate display in the editor and a
relative asset path for saved document HTML.

`createCollectionImagePasteExtension` is the TipTap paste/drop hook. It does not
save anything by itself. It reads image bytes and passes them to `handleImage`.

`createCollectionImagePasteHandler` is the bridge-aware handler. It builds a
relative path under the document folder, writes the bytes with `writeBinary`,
then inserts the image into the current editor.

Keep the byte/base64 adapter functions at the app bridge boundary if multiple
components need images. Component code should call domain-named helpers, not
repeat raw bridge conversion details.

Use `insertCollectionImageFromBinaryResult` when the app already loaded an
asset as `{ mimeType, base64 }` and needs to insert it into the editor, for
example from an asset picker.

## Auto Review

Auto review means: collect paragraphs from the current document, send those
paragraphs to an app-provided review model/tool, validate the returned findings
against the original paragraph text, then apply accepted findings as editor
comments.

The editor owns paragraph collection, finding validation, and comment
application. The app owns the review provider because the app decides which
agent, model, network call, prompt, or bridge helper performs the review.

Use auto review for document products that need editorial annotations, for
example copy editing, fact checking, source review, logic review, claim review,
or voice review. Do not use it for normal spellcheck or for apps that only need
a plain text box.

The provider contract is:

```tsx
import {
  buildAutoReviewPrompt,
  parseAutoReviewFindingResponse,
  type AutoReviewFindingsProvider,
} from '@purescience/platform-ui/editor'

const findingsProvider: AutoReviewFindingsProvider = async ({
  paragraphs,
  options,
}) => {
  const prompt = buildAutoReviewPrompt('copyedit', paragraphs)

  // Call the app's chosen review path here:
  // - an app-scoped shell agent session;
  // - a permitted network endpoint;
  // - an app-owned bridge helper.
  const modelResponse = await runDocumentReview(prompt, options)

  return parseAutoReviewFindingResponse(modelResponse)
}
```

`modelResponse` must be JSON that describes findings. Each finding points at an
exact span inside one collected paragraph:

```json
{
  "findings": [
    {
      "paragraph_id": "p-1",
      "exact_text": "the exact words in the paragraph",
      "annotation_type": "copyedit",
      "suggested_note": "Short note shown to the user.",
      "severity": "minor",
      "confidence": 0.8
    }
  ]
}
```

Then run the review from the editor handle:

```tsx
const result = await editorRef.current?.runAutoReview({
  process: 'copyedit',
  enabledTypes: ['copyedit'],
  findingsProvider,
  maxFindings: 12,
  minConfidence: 0.55,
})
```

If `findingsProvider` is missing, `runAutoReview` returns an
`unavailableReason` and does not annotate the document. If a finding's
`exact_text` cannot be found in its paragraph, the editor skips it. The model
does not edit the document directly; it only returns findings that the editor
validates and applies as comments.
