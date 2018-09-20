import { list, create, watch, currentUser, OpenShiftWatchEvents } from './openshiftServices';
import { walkthroughTypes } from '../redux/constants';
import { FULFILLED_ACTION } from '../redux/helpers';
import { buildServiceInstanceResourceObj, DEFAULT_SERVICES } from './serviceInstanceServices';

const WALKTHROUGH_SERVICES = ['fuse', 'che', 'launcher', 'enmasse-standard', 'amq-broker-71-persistence'];

class DefaultOpenshiftResourceCreator {
  canHandle() {
    return true;
  }

  create(resourceDef, resource) {
    return create(resourceDef, resource);
  }
}

class AMQResourceCreator {
  canHandle(resource) {
    return resource.spec.clusterServiceClassExternalName === DEFAULT_SERVICES.AMQ;
  }

  create(resourceDef, resource) {
    return currentUser().then(currentUser => {
      const userNamespace = buildValidProjectNamespaceName(currentUser.username);
      const statefulSetDef = {
        name: 'statefulsets',
        group: 'apps',
        version: 'v1beta1',
        namespace: userNamespace
      }
      const statefulSetObj = {
        metadata: {
          name: 'broker-amq'
        }
      }
      const secretDef = {
        name: 'secrets',
        namespace: userNamespace,
        version: 'v1'
      };
      return create(resourceDef, resource)
        .then(() => {
          findOpenshiftResource(statefulSetDef, statefulSetObj)
            .then(statefulSet => {
              console.log('statefulset', statefulSet);
            });

          create(secretDef, {
            kind: 'Secret',
            metadata: {
              name: 'amq-credentials'
            },
            stringData: {
              username: 'super',
              password: 'duper'
            }
          });
        });
    });
  }
}

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
      });
  });
};

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

const DEFAULT_RESOURCE_CREATORS = [new AMQResourceCreator(), new DefaultOpenshiftResourceCreator()];

const findOrCreateOpenshiftResource = (openshiftResourceDef, resToFind, compareFn, resourceCreators = DEFAULT_RESOURCE_CREATORS) =>
  findOpenshiftResource(openshiftResourceDef, resToFind, compareFn).then(foundResource => {
    if (!foundResource) {
      const resourceCreator = resourceCreators.find(rc => rc.canHandle(resToFind));
      if (!resourceCreator) {
        return Promise.reject(new Error(`Could not find resource creator for ${resToFind.metadata.name}`));
      }
      return resourceCreator.create(openshiftResourceDef, resToFind);
    }
    return Promise.resolve(foundResource);
  });

const buildValidProjectNamespaceName = username => `${cleanUsername(username)}-walkthrough-projects`;

const cleanUsername = username => username.replace(/@/g, '-').replace(/\./g, '-');

export { manageUserWalkthrough, mockUserWalkthrough };
