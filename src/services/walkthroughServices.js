import { list, create, remove, watch, currentUser, OpenShiftWatchEvents } from './openshiftServices';
import { walkthroughTypes } from '../redux/constants';
import { FULFILLED_ACTION } from '../redux/helpers';
import { buildServiceInstanceResourceObj, DEFAULT_SERVICES } from './serviceInstanceServices';

const WALKTHROUGH_SERVICES = ['fuse', 'che', 'launcher', 'enmasse-standard', 'amq-broker-71-persistence'];

const mockUserWalkthrough = (dispatch, mockData) => {
  if (!mockData || !mockData.serviceInstances) {
    return;
  }
  mockData.serviceInstances.forEach(si =>
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.CREATE_WALKTHROUGH),
      payload: si
    })
  );
};

const manageUserWalkthrough = dispatch => {
  currentUser().then(user => {
    const userNamespace = buildValidProjectNamespaceName(user.username);

    const namespaceRequestResourceDef = {
      name: 'projectrequests',
      version: 'v1',
      group: 'project.openshift.io'
    };
    const namespaceResourceDef = {
      name: 'projects',
      version: 'v1',
      group: 'project.openshift.io'
    };
    const namespaceObj = {
      kind: 'ProjectRequest',
      metadata: {
        name: userNamespace
      }
    };

    const serviceInstanceDef = {
      name: 'serviceinstances',
      namespace: userNamespace,
      version: 'v1beta1',
      group: 'servicecatalog.k8s.io'
    };
    const statefulSetDef = {
      name: 'statefulsets',
      group: 'apps',
      version: 'v1beta1',
      namespace: userNamespace
    }

    findOpenshiftResource(namespaceResourceDef, namespaceObj)
      .then(foundResource => {
        if (!foundResource) {
          return create(namespaceRequestResourceDef, namespaceObj);
        }
        return foundResource;
      })
      .then(() => {
        const siObjs = WALKTHROUGH_SERVICES.map(name =>
          buildServiceInstanceResourceObj({ namespace: userNamespace, name, user })
        );
        return Promise.all(
          siObjs.map(siObj =>
            findOrCreateOpenshiftResource(
              serviceInstanceDef,
              siObj,
              resObj => resObj.spec.clusterServiceClassExternalName === siObj.spec.clusterServiceClassExternalName
            )
          )
        );
      })
      .then(() => {
        watch(serviceInstanceDef).then(watchListener =>
          watchListener.onEvent(handleServiceInstanceWatchEvents.bind(null, dispatch))
        );
        watch(statefulSetDef).then(watchListener => watchListener.onEvent(handleAMQStatefulSet.bind(null, userNamespace)));
      });
  });
};

const handleAMQStatefulSet = (namespace, event) => {
  if (event.type === OpenShiftWatchEvents.OPENED || event.type === OpenShiftWatchEvents.CLOSED) {
    return;
  }
  const sSet = event.payload;
  if (!sSet.spec || !sSet.spec.template || !sSet.spec.template.spec || !sSet.spec.template.spec.containers || !sSet.spec.template.spec.containers[0]) {
    return;
  }
  const specContainer = sSet.spec.template.spec.containers[0];
  if (!specContainer.env) {
    return;
  }

  const usernameEnv = specContainer.env.find(e => e.name === 'AMQ_USER');
  const passwordEnv = specContainer.env.find(e => e.name === 'AMQ_PASSWORD');
  if (!usernameEnv.value || !passwordEnv.value) {
    return;
  }

  const secretDef = {
    name: 'secrets',
    version: 'v1',
    namespace: namespace
  }
  const secretRes = {
    metadata: {
      name: 'amq-broker-credentials'
    },
    stringData: {
      username: usernameEnv.value,
      password: passwordEnv.value
    }
  }
  replaceOpenShiftResource(secretDef, secretRes, secret => {
    return secret.data.username !== window.btoa(usernameEnv.value) || secret.data.password !== window.btoa(passwordEnv.value);
  });
}

const handleServiceInstanceWatchEvents = (dispatch, event) => {
  if (event.type === OpenShiftWatchEvents.OPENED || event.type === OpenShiftWatchEvents.CLOSED) {
    return;
  }

  if (!WALKTHROUGH_SERVICES.includes(event.payload.spec.clusterServiceClassExternalName)) {
    return;
  }
  if (event.type === OpenShiftWatchEvents.ADDED || event.type === OpenShiftWatchEvents.MODIFIED) {
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.CREATE_WALKTHROUGH),
      payload: event.payload
    });
  }
  if (event.type === OpenShiftWatchEvents.DELETED) {
    dispatch({
      type: FULFILLED_ACTION(walkthroughTypes.REMOVE_WALKTHROUGH),
      payload: event.payload
    });
  }
};

const findOpenshiftResource = (openshiftResourceDef, resToFind, compareFn = (resObj => resObj.metadata.name === resToFind.metadata.name)) =>
  list(openshiftResourceDef)
    .then(listResponse => listResponse && listResponse.items ? listResponse.items : [])
    .then(resourceObjs => {
      return resourceObjs.find(resObj => compareFn(resObj));
    });

const findOrCreateOpenshiftResource = (openshiftResourceDef, resToFind, compareFn) =>
  findOpenshiftResource(openshiftResourceDef, resToFind, compareFn).then(foundResource => {
    if (!foundResource) {
      return create(openshiftResourceDef, resToFind);
    }
    return Promise.resolve(foundResource);
  });

const replaceOpenShiftResource = (resourceDef, resourceRes, replaceIfFn = (resObj => resObj.metadata.name === resourceRes.metadata.name)) =>
  findOrCreateOpenshiftResource(resourceDef, resourceRes)
    .then(resource => {
      if (replaceIfFn(resource)) {
        return remove(resourceDef, resourceRes).then(() => create(resourceDef, resourceRes));
      }
      return Promise.resolve(resource);
    });

const buildValidProjectNamespaceName = username => `${cleanUsername(username)}-walkthrough-projects`;

const cleanUsername = username => username.replace(/@/g, '-').replace(/\./g, '-');

export { manageUserWalkthrough, mockUserWalkthrough };
