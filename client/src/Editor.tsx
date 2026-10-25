import MDEditor from '@uiw/react-md-editor';

export default function Editor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <MDEditor value={value} onChange={(v) => onChange(v ?? '')} preview="live" height="100%" style={{ height: '100%' }} />;
}
