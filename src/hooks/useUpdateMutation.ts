import { useMutation, useQueryClient } from "@tanstack/react-query";

type UpdateFn<Args extends any[] = any[], Result = any> = (
  ...args: Args
) => Promise<Result>;

export function useUpdateMutation<Args extends any[] = any[], Result = any>(
  updateFn: UpdateFn<Args, Result>,
) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (...args: Args) => updateFn(...args),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  return {
    mutate: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

export default useUpdateMutation;
