const { events, Job } = require("@brigadecore/brigadier");
const kubernetes = require("@kubernetes/client-node");
const yaml = require("js-yaml");

const k8sClient = kubernetes.Config.defaultClient();

const BRIGADE_NAMESPACE = "brigade";
const GITHUB_API_URL = "https://api.github.com/repos";

const protectedEnvironment = namespaceName => {
  const protectedNamespaces = [
    "default",
    "kube-public",
    "kube-system",
    "brigade",
  ];

  if (protectedNamespaces.includes(namespaceName)) {
    return true;
  }
  return false;
};

const createNamespace = async namespaceName => {
  const existingNamespace = await k8sClient.listNamespace(
    true,
    "",
    `metadata.name=${namespaceName}`,
  );
  if (existingNamespace.body.items.length) {
    console.log(`Namespace "${namespaceName}" already exists`);
    return;
  }

  console.log(`Creating namespace "${namespaceName}"`);
  const namespace = new kubernetes.V1Namespace();
  namespace.metadata = new kubernetes.V1ObjectMeta();
  namespace.metadata.name = namespaceName;

  await k8sClient.createNamespace(namespace);
  console.log(`Done creating new namespace "${namespaceName}"`);
};

const createEnvironmentConfigMap = async (name, projects) => {
  console.log("creating environment configMap");
  const configMap = new kubernetes.V1ConfigMap();
  const metadata = new kubernetes.V1ObjectMeta();
  metadata.name = `preview-environment-${name}`;
  metadata.namespace = BRIGADE_NAMESPACE;
  metadata.labels = {
    type: "preview-environment-config",
    environmentName: name,
  };
  configMap.metadata = metadata;
  configMap.data = {
    environment: yaml.dump(projects),
  };

  try {
    await k8sClient.createNamespacedConfigMap(BRIGADE_NAMESPACE, configMap);
  } catch (error) {
    if (error.body && error.body.code === 409) {
      await k8sClient.replaceNamespacedConfigMap(
        configMap.metadata.name,
        BRIGADE_NAMESPACE,
        configMap,
      );
    } else {
      throw error;
    }
  }
  console.log("done creating environment configMap");
};

const ensurePodIsRunning = async (environmentName, appLabel) => {
  let podIsRunning = false;
  while (!podIsRunning) {
    const pod = await k8sClient.listNamespacedPod(
      environmentName,
      undefined,
      undefined,
      "status.phase=Running",
      false,
      `app=${appLabel}`,
    );
    if (pod.body.items.length) {
      console.log(`Pod ${appLabel} is ready`);
      podIsRunning = true;
    } else {
      console.log(`Waiting for ${appLabel} pod to be ready`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

const deployDependencies = async environmentName => {
  console.log("deploying dependencies");
  const postgresql = new Job("postgresql", "lachlanevenson/k8s-helm:v2.12.3");
  postgresql.storage.enabled = false;
  postgresql.imageForcePull = true;
  postgresql.tasks = [
    `helm init --client-only && \
     helm repo update && \
     helm upgrade ${environmentName}-postgresql stable/postgresql \
    --install --namespace=${environmentName} \
    --set fullnameOverride=postgresql \
    --set postgresqlDatabase=products \
    --set resources.requests.cpu=50m \
    --set resources.requests.memory=156Mi \
    --set readinessProbe.initialDelaySeconds=60 \
    --set livenessProbe.initialDelaySeconds=60;`,
  ];

  await postgresql.run();
  await ensurePodIsRunning(environmentName, "postgresql");
  console.log("done deploying dependencies");
};

const provisionEnvironment = async (environmentName, projects) => {
  await createNamespace(environmentName);
  await createEnvironmentConfigMap(environmentName, projects);
  await deployDependencies(environmentName);
};

const logError = error => {
  console.log("ERROR");
  if (error.body) {
    // Errors coming from k8s client will have all
    // relevant info in the `body` field.
    console.log(error.body);
  } else {
    console.log(error);
  }
  throw error;
};

events.on("exec", event => {
  try {
    const payload = JSON.parse(event.payload);
    const { name, projects, action } = payload;

    if (!name) {
      throw Error("Environment name must be specified");
    }
    if (protectedEnvironment(name)) {
      throw Error(`Environment '${name}' is protected`);
    }

    switch (action) {
      case "create":
        provisionEnvironment(name, projects).catch(error => {
          logError(error);
        });
        break;
      case "delete":
        destroyEnvironment(name).catch(error => {
          logError(error);
        });
        break;
      case "refresh":
        refreshDeployments(name, projects).catch(error => {
          logError(error);
        });
        break;
      default:
        throw Error("Not a supported action");
    }
  } catch (error) {
    logError(error);
  }
});
