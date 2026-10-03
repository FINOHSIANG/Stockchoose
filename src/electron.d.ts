interface StockChooseStorageResult<T = unknown> {
  ok: boolean;
  found?: boolean;
  value?: T;
  error?: string;
}

interface Window {
  stockChooseDesktop?: {
    platform: string;
    version: string;
    storage?: {
      load<T>(name: string): StockChooseStorageResult<T>;
      save<T>(name: string, value: T): StockChooseStorageResult;
      remove(name: string): StockChooseStorageResult;
    };
  };
}
