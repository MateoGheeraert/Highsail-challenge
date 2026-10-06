import { useState } from 'react';
import { View } from 'react-native';
import { Button, Notice, Text, TextField } from '@/components';
import type { JobInput } from './api';

export function JobForm({ initial, onSave, onCancel }: {
  initial?: JobInput; onSave: (value: JobInput) => Promise<void>; onCancel: () => void;
}) {
  const [value, setValue] = useState<JobInput>({ title: initial?.title ?? '', generalRemarks: initial?.generalRemarks ?? '', priority: initial?.priority ?? null, jobComplete: initial?.jobComplete ?? null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!value.title.trim()) { setError('Enter a job title.'); return; }
    setBusy(true); setError('');
    try { await onSave({ ...value, title: value.title.trim(), generalRemarks: value.generalRemarks?.trim() || null }); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save the job. Please try again.'); }
    finally { setBusy(false); }
  }
  return <View className="gap-4">
    <TextField label="Job title" value={value.title} maxLength={160} disabled={busy} onChangeText={title => setValue({ ...value, title })} />
    <TextField label="Remarks" value={value.generalRemarks ?? ''} multiline maxLength={5000} disabled={busy} onChangeText={generalRemarks => setValue({ ...value, generalRemarks })} />
    <Text variant="label">Priority</Text>
    <View className="flex-row flex-wrap gap-2">{([null, 'low', 'medium', 'high'] as const).map(priority =>
      <Button key={priority ?? 'none'} disabled={busy} variant={value.priority === priority ? 'primary' : 'secondary'} onPress={() => setValue({ ...value, priority })}>{priority ?? 'Unset'}</Button>)}</View>
    <Text variant="label">Status</Text>
    <View className="gap-2">{([{ label: 'Unset', status: null }, { label: 'In progress', status: false }, { label: 'Complete', status: true }] as const).map(({ label, status }) =>
      <Button key={label} disabled={busy} variant={value.jobComplete === status ? 'primary' : 'secondary'} onPress={() => setValue({ ...value, jobComplete: status })}>{label}</Button>)}</View>
    {error ? <Notice>{error}</Notice> : null}
    <Button loading={busy} onPress={save}>{initial ? 'Save changes' : 'Create job'}</Button>
    <Button variant="text" disabled={busy} onPress={onCancel}>Cancel</Button>
  </View>;
}
