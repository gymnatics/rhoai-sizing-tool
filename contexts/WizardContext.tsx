'use client';

import * as React from 'react';
import {
  WizardState, DEFAULT_WIZARD_STATE, CustomerProfile, SizedModel, UseCase, PlatformConfig,
  SizingIntake, createEmptyUseCase, WizardMode,
} from '@/lib/wizard/types';

const STORAGE_KEY = 'rhoai_sizing_wizard_state';

interface WizardContextValue {
  hydrated: boolean;
  state: WizardState;
  setWizardMode: (m: WizardMode) => void;
  setCustomer: (c: CustomerProfile) => void;
  addSizedModel: (m: SizedModel) => void;
  removeSizedModel: (id: string) => void;
  setUseCases: (u: UseCase[]) => void;
  addUseCase: () => void;
  updateUseCase: (id: string, patch: Partial<UseCase>) => void;
  removeUseCase: (id: string) => void;
  setPlatform: (p: PlatformConfig) => void;
  importIntake: (intake: SizingIntake) => void;
  reset: () => void;
}

const WizardContext = React.createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = React.useState(false);
  const [state, setState] = React.useState<WizardState>(DEFAULT_WIZARD_STATE);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...DEFAULT_WIZARD_STATE, ...JSON.parse(raw) });
    } catch {
      // ignore corrupt localStorage
    }
    setHydrated(true);
  }, []);

  const persist = React.useCallback((next: WizardState) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full / unavailable — state still lives in memory for this session
    }
  }, []);

  const setWizardMode = React.useCallback((m: WizardMode) => {
    persist({ ...state, wizardMode: m });
  }, [state, persist]);

  const setCustomer = React.useCallback((c: CustomerProfile) => {
    persist({ ...state, customer: c });
  }, [state, persist]);

  const addSizedModel = React.useCallback((m: SizedModel) => {
    persist({ ...state, sizedModels: [...state.sizedModels, m] });
  }, [state, persist]);

  const removeSizedModel = React.useCallback((id: string) => {
    persist({
      ...state,
      sizedModels: state.sizedModels.filter(m => m.id !== id),
      useCases: state.useCases.map(u => u.sizedModelId === id ? { ...u, sizedModelId: null } : u),
    });
  }, [state, persist]);

  const setUseCases = React.useCallback((u: UseCase[]) => {
    persist({ ...state, useCases: u });
  }, [state, persist]);

  const addUseCase = React.useCallback(() => {
    const id = `uc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    persist({ ...state, useCases: [...state.useCases, createEmptyUseCase(id)] });
  }, [state, persist]);

  const updateUseCase = React.useCallback((id: string, patch: Partial<UseCase>) => {
    persist({
      ...state,
      useCases: state.useCases.map(u => u.id === id ? { ...u, ...patch } : u),
    });
  }, [state, persist]);

  const removeUseCase = React.useCallback((id: string) => {
    persist({ ...state, useCases: state.useCases.filter(u => u.id !== id) });
  }, [state, persist]);

  const setPlatform = React.useCallback((p: PlatformConfig) => {
    persist({ ...state, platform: p });
  }, [state, persist]);

  const importIntake = React.useCallback((intake: SizingIntake) => {
    const customer: CustomerProfile = {
      ...state.customer,
      name: intake.customer.name || state.customer.name,
      project: intake.customer.project || state.customer.project,
      deploymentType: intake.customer.deployment_type || state.customer.deploymentType,
      openshiftVersion: intake.customer.openshift_version || state.customer.openshiftVersion,
      connectivity: intake.customer.connectivity || state.customer.connectivity,
      target: intake.customer.target || state.customer.target,
      existingHardware: intake.hardware.existing.map((h, i) => ({
        id: `existing_${i}`, gpu: h.gpu, count: h.count ?? 0,
        formFactor: h.form_factor ?? undefined, servers: h.servers ?? undefined,
      })),
      plannedHardware: intake.hardware.planned.map((h, i) => ({
        id: `planned_${i}`, gpu: h.gpu, count: h.count ?? 0,
        formFactor: h.form_factor ?? undefined, servers: h.servers ?? undefined,
      })),
      growthHorizonYears: intake.growth.horizon_years ?? state.customer.growthHorizonYears,
      annualGrowthRate: intake.growth.annual_growth_rate ?? state.customer.annualGrowthRate,
    };

    const useCases: UseCase[] = intake.use_cases.map((uc, i) => ({
      ...createEmptyUseCase(`uc_intake_${i}`),
      name: uc.name,
      concurrentUsersLow: uc.concurrent_users_low ?? 10,
      concurrentUsersHigh: uc.concurrent_users_high ?? uc.concurrent_users_low ?? 50,
      inputTokens: uc.input_tokens ?? 4000,
      outputTokens: uc.output_tokens ?? 500,
      ttftTargetS: uc.ttft_target_s ?? 3,
      tokensPerSecondTarget: uc.tokens_per_s_target ?? 50,
      notes: [uc.notes, uc.model_preference ? `Preferred model: ${uc.model_preference}` : null]
        .filter(Boolean).join(' — '),
    }));

    persist({ ...state, customer, useCases });
  }, [state, persist]);

  const reset = React.useCallback(() => {
    persist(DEFAULT_WIZARD_STATE);
  }, [persist]);

  const value = React.useMemo<WizardContextValue>(() => ({
    hydrated, state, setWizardMode, setCustomer, addSizedModel, removeSizedModel,
    setUseCases, addUseCase, updateUseCase, removeUseCase, setPlatform,
    importIntake, reset,
  }), [hydrated, state, setWizardMode, setCustomer, addSizedModel, removeSizedModel,
      setUseCases, addUseCase, updateUseCase, removeUseCase, setPlatform,
      importIntake, reset]);

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = React.useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within a WizardProvider');
  return ctx;
}
