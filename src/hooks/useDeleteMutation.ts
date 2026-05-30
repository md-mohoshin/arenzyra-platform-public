import { useMutation, useQueryClient } from "@tanstack/react-query";

type DeleteFn = () => Promise<any>;

export function useDeleteMutation(deleteFn: DeleteFn) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: deleteFn,
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

export default useDeleteMutation;
