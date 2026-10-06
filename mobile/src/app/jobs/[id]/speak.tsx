import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandMark, Button, Notice, Screen, Text } from '@/components';
import { jobsApi, type Job } from '@/features/jobs/api';
import { colors } from '@/theme/tokens';

export default function Speak() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    jobsApi.get(id).then(job => { if (active) setJob(job); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [id, attempt]);
  return <Screen><View className="flex-1 gap-6">
    <Button variant="text" onPress={() => router.replace(`/jobs/${id}`)}>Back to job</Button>
    {error ? <><Notice>{error}</Notice><Button variant="secondary" onPress={() => setAttempt(value => value + 1)}>Retry</Button></> : job ? <>
      <Text muted>{job.title}</Text><Text variant="title">Speak your job notes</Text>
      <View className="items-center gap-6 p-8" style={{ backgroundColor: colors.primarySoft, borderRadius: 24 }}>
        <BrandMark /><Text variant="heading">Voice capture is coming next</Text>
        <Text muted>You’ll be able to describe your work and review the suggested job details here.</Text>
        <Button disabled onPress={() => {}}>Start speaking</Button>
        <Text variant="caption" muted>Recording is not available yet.</Text>
      </View>
      <Text muted>For now, use Edit job to add your details manually.</Text>
    </> : <Text muted>Loading job...</Text>}
  </View></Screen>;
}
