<template>
  <DrawerContent :title="$t('quick-action.transfer-in-db-title')">
    <div
      class="px-4 w-[calc(100vw-8rem)] lg:w-[60rem] max-w-[calc(100vw-8rem)]"
    >
      <div
        v-if="state.loading"
        class="absolute inset-0 z-10 bg-white/70 flex items-center justify-center"
      >
        <BBSpin />
      </div>
      <div v-else class="space-y-4">
        <TransferSourceSelector
          :project="project"
          :raw-database-list="rawDatabaseList"
          :transfer-source="state.transferSource"
          :instance-filter="state.instanceFilter"
          :project-filter="state.projectFilter"
          :search-text="state.searchText"
          :has-permission-for-default-project="hasPermissionForDefaultProject"
          @change="state.transferSource = $event"
          @select-instance="state.instanceFilter = $event"
          @select-project="state.projectFilter = $event"
          @search-text-change="state.searchText = $event"
        />
        <MultipleDatabaseSelector
          v-if="filteredDatabaseList.length > 0"
          v-model:selected-uid-list="state.selectedDatabaseUidList"
          :transfer-source="state.transferSource"
          :database-list="filteredDatabaseList"
        />
        <NoDataPlaceholder v-else />
      </div>
    </div>

    <template #footer>
      <div class="flex-1 flex items-center justify-between">
        <div>
          <div
            v-if="state.selectedDatabaseUidList.length > 0"
            class="textinfolabel"
          >
            {{
              $t("database.selected-n-databases", {
                n: state.selectedDatabaseUidList.length,
              })
            }}
          </div>
        </div>
        <div class="flex items-center gap-x-3">
          <NButton @click.prevent="$emit('dismiss')">
            {{ $t("common.cancel") }}
          </NButton>
          <NButton
            type="primary"
            :disabled="!allowTransfer"
            @click.prevent="transferDatabase"
          >
            {{ $t("common.transfer") }}
          </NButton>
        </div>
      </div>
    </template>
  </DrawerContent>
</template>

<script lang="ts" setup>
import { cloneDeep } from "lodash-es";
import { computed, reactive } from "vue";
import { toRef } from "vue";
import type { TransferSource } from "@/components/TransferDatabaseForm";
import {
  MultipleDatabaseSelector,
  TransferSourceSelector,
} from "@/components/TransferDatabaseForm";
import {
  pushNotification,
  useCurrentUserV1,
  useDatabaseV1Store,
  useProjectV1ByUID,
  useProjectV1Store,
} from "@/store";
import type { ComposedInstance } from "@/types";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_V1_NAME,
  UNKNOWN_INSTANCE_NAME,
} from "@/types";
import type { UpdateDatabaseRequest } from "@/types/proto/v1/database_service";
import type { Project } from "@/types/proto/v1/project_service";
import {
  filterDatabaseV1ByKeyword,
  hasProjectPermissionV2,
  sortDatabaseV1List,
} from "@/utils";

interface LocalState {
  transferSource: TransferSource;
  instanceFilter: ComposedInstance | undefined;
  projectFilter: Project | undefined;
  searchText: string;
  loading: boolean;
  selectedDatabaseUidList: string[];
}

const props = defineProps<{
  projectId: string;
}>();

const emit = defineEmits<{
  (e: "dismiss"): void;
}>();

const currentUserV1 = useCurrentUserV1();
const databaseStore = useDatabaseV1Store();
const projectStore = useProjectV1Store();

const defaultProject = computed(() => {
  return projectStore.getProjectByName(DEFAULT_PROJECT_V1_NAME);
});

const hasPermissionForDefaultProject = computed(() => {
  return hasProjectPermissionV2(
    defaultProject.value,
    currentUserV1.value,
    "bb.projects.update"
  );
});

const state = reactive<LocalState>({
  transferSource:
    props.projectId === String(DEFAULT_PROJECT_ID) ||
    !hasPermissionForDefaultProject.value
      ? "OTHER"
      : "DEFAULT",
  instanceFilter: undefined,
  projectFilter: undefined,
  searchText: "",
  loading: false,
  selectedDatabaseUidList: [],
});
const { project } = useProjectV1ByUID(toRef(props, "projectId"));

const rawDatabaseList = computed(() => {
  if (state.transferSource === "DEFAULT") {
    return databaseStore.databaseListByProject(DEFAULT_PROJECT_V1_NAME);
  } else {
    return databaseStore.databaseList.filter((item) => {
      return (
        item.projectEntity.uid !== props.projectId &&
        item.project !== DEFAULT_PROJECT_V1_NAME &&
        hasProjectPermissionV2(
          item.projectEntity,
          currentUserV1.value,
          "bb.projects.update"
        )
      );
    });
  }
});

const filteredDatabaseList = computed(() => {
  let list = [...rawDatabaseList.value];
  const keyword = state.searchText.trim();
  list = list.filter((db) =>
    filterDatabaseV1ByKeyword(db, keyword, [
      "name",
      "project",
      "instance",
      "environment",
    ])
  );

  list = list.filter((db) => {
    // Default uses instance filter
    if (state.transferSource === "DEFAULT") {
      const instance = state.instanceFilter;
      if (
        instance &&
        instance.name !== UNKNOWN_INSTANCE_NAME &&
        db.instance !== instance.name
      ) {
        return false;
      }
    }

    // Other uses project filter
    if (state.transferSource === "OTHER") {
      const project = state.projectFilter;
      if (project && db.project != project.name) {
        return false;
      }
    }

    return true;
  });

  return sortDatabaseV1List(list);
});

const allowTransfer = computed(() => state.selectedDatabaseUidList.length > 0);

const transferDatabase = async () => {
  const databaseList = state.selectedDatabaseUidList.map((uid) =>
    databaseStore.getDatabaseByUID(uid)
  );

  try {
    state.loading = true;
    const updates = databaseList.map((db) => {
      const targetProject = projectStore.getProjectByUID(props.projectId);
      const databasePatch = cloneDeep(db);
      databasePatch.project = targetProject.name;
      const updateMask = ["project"];
      return {
        database: databasePatch,
        updateMask,
      } as UpdateDatabaseRequest;
    });
    await databaseStore.batchUpdateDatabases({
      parent: "-",
      requests: updates,
    });
    const displayDatabaseName =
      databaseList.length > 1
        ? `${databaseList.length} databases`
        : `'${databaseList[0].databaseName}'`;

    pushNotification({
      module: "bytebase",
      style: "SUCCESS",
      title: `Successfully transferred ${displayDatabaseName} to project '${project.value.title}'.`,
    });
    emit("dismiss");
  } finally {
    state.loading = false;
  }
};
</script>
